const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'social.db'));
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  bio TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS comments(
  id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS likes(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, post_id));
CREATE TABLE IF NOT EXISTS follows(
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(follower_id, followed_id));
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- auth helpers ----
const sign = u => jwt.sign({ id: u.id, username: u.username }, SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: 'Login required' }); }
}
const getUser = name => db.prepare('SELECT * FROM users WHERE username = ?').get(name);
const clean = (s, max) => String(s || '').trim().slice(0, max);

app.post('/api/register', (req, res) => {
  const username = clean(req.body.username, 20), password = String(req.body.password || '');
  if (!/^\w{3,20}$/.test(username)) return res.status(400).json({ error: 'Username: 3-20 letters, numbers or _' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (getUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const r = db.prepare('INSERT INTO users(username,password) VALUES(?,?)').run(username, bcrypt.hashSync(password, 10));
  res.json({ token: sign({ id: r.lastInsertRowid, username }), username });
});

app.post('/api/login', (req, res) => {
  const u = getUser(clean(req.body.username, 20));
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password))
    return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: sign(u), username: u.username });
});

// ---- profiles ----
app.get('/api/users/:username', auth, (req, res) => {
  const u = getUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const c = (sql) => db.prepare(sql).get(u.id).n;
  res.json({
    username: u.username, bio: u.bio, joined: u.created_at,
    posts: c('SELECT COUNT(*) n FROM posts WHERE user_id=?'),
    followers: c('SELECT COUNT(*) n FROM follows WHERE followed_id=?'),
    following: c('SELECT COUNT(*) n FROM follows WHERE follower_id=?'),
    isFollowing: !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND followed_id=?').get(req.user.id, u.id),
    isMe: u.id === req.user.id
  });
});

app.put('/api/me', auth, (req, res) => {
  db.prepare('UPDATE users SET bio=? WHERE id=?').run(clean(req.body.bio, 160), req.user.id);
  res.json({ ok: true });
});

app.get('/api/suggestions', auth, (req, res) => {
  res.json(db.prepare(`SELECT username FROM users WHERE id != ?1
    AND id NOT IN (SELECT followed_id FROM follows WHERE follower_id = ?1)
    ORDER BY RANDOM() LIMIT 5`).all(req.user.id));
});

app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = getUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: "You can't follow yourself" });
  const del = db.prepare('DELETE FROM follows WHERE follower_id=? AND followed_id=?').run(req.user.id, u.id);
  if (!del.changes) db.prepare('INSERT INTO follows VALUES(?,?)').run(req.user.id, u.id);
  res.json({ following: !del.changes });
});

// ---- posts ----
const POST_SQL = `SELECT p.id, p.content, p.created_at, u.username,
  (SELECT COUNT(*) FROM likes WHERE post_id=p.id) likes,
  (SELECT COUNT(*) FROM comments WHERE post_id=p.id) comments,
  EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=@me) liked
  FROM posts p JOIN users u ON u.id=p.user_id`;

app.get('/api/posts', auth, (req, res) => {
  const me = req.user.id, { scope, user } = req.query;
  let where = '', params = { me };
  if (scope === 'following') {
    where = 'WHERE p.user_id=@me OR p.user_id IN (SELECT followed_id FROM follows WHERE follower_id=@me)';
  } else if (user) { where = 'WHERE u.username=@user'; params.user = user; }
  res.json(db.prepare(`${POST_SQL} ${where} ORDER BY p.id DESC LIMIT 100`).all(params)
    .map(p => ({ ...p, liked: !!p.liked, mine: p.username === req.user.username })));
});

app.post('/api/posts', auth, (req, res) => {
  const content = clean(req.body.content, 280);
  if (!content) return res.status(400).json({ error: 'Post cannot be empty' });
  db.prepare('INSERT INTO posts(user_id,content) VALUES(?,?)').run(req.user.id, content);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM posts WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  r.changes ? res.json({ ok: true }) : res.status(403).json({ error: 'Not allowed' });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  const del = db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.user.id, req.params.id);
  if (!del.changes) db.prepare('INSERT INTO likes VALUES(?,?)').run(req.user.id, req.params.id);
  const n = db.prepare('SELECT COUNT(*) n FROM likes WHERE post_id=?').get(req.params.id).n;
  res.json({ liked: !del.changes, likes: n });
});

// ---- comments ----
app.get('/api/posts/:id/comments', auth, (req, res) => {
  res.json(db.prepare(`SELECT c.id, c.content, c.created_at, u.username FROM comments c
    JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.id`).all(req.params.id));
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const content = clean(req.body.content, 200);
  if (!content) return res.status(400).json({ error: 'Comment cannot be empty' });
  if (!db.prepare('SELECT 1 FROM posts WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Post not found' });
  db.prepare('INSERT INTO comments(post_id,user_id,content) VALUES(?,?,?)').run(req.params.id, req.user.id, content);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Mini Social running at http://localhost:${PORT}`));
