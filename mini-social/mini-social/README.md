# Mini Social

A small social media app: user profiles, posts, comments, likes and follows.

**Stack:** HTML/CSS/vanilla JS frontend · Express.js backend · SQLite database (better-sqlite3)

## Run
```bash
npm install
npm start
```
Open http://localhost:3000, sign up, and start posting. Create a second account
(in a private window) to try following, liking and commenting.

The database file `social.db` is created automatically on first run.
Set `JWT_SECRET` and `PORT` environment variables for production use.

## Database tables
- `users` (id, username, password hash, bio)
- `posts` (id, user_id, content)
- `comments` (id, post_id, user_id, content)
- `likes` (user_id, post_id)
- `follows` (follower_id, followed_id)

## REST API (JWT Bearer auth)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | /api/register, /api/login | Auth |
| GET | /api/users/:username | Profile + counts |
| PUT | /api/me | Update bio |
| POST | /api/users/:username/follow | Toggle follow |
| GET | /api/posts?scope=following\|all&user=name | Feed / user posts |
| POST | /api/posts | Create post |
| DELETE | /api/posts/:id | Delete own post |
| POST | /api/posts/:id/like | Toggle like |
| GET/POST | /api/posts/:id/comments | List / add comments |
