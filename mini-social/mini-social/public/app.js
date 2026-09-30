const $ = s => document.querySelector(s);
const app = $('#app');
let token = localStorage.getItem('token'), me = localStorage.getItem('username');
let feedScope = 'following';

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago = d => {
  const s = (Date.now() - new Date(d + 'Z')) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

async function api(url, method = 'GET', body) {
  const res = await fetch('/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function logout() {
  localStorage.clear(); token = me = null; location.hash = '#/'; route();
}
$('#logout').onclick = logout;

// ---------- Views ----------
function authView() {
  $('#nav').hidden = true;
  let mode = 'login';
  const draw = () => {
    app.innerHTML = `<div class="card auth">
      <h2>${mode === 'login' ? 'Log in' : 'Create account'}</h2>
      <p class="error" id="err"></p>
      <input id="u" placeholder="Username" autocomplete="username">
      <input id="p" type="password" placeholder="Password (min 6 chars)" autocomplete="current-password">
      <button id="go" style="width:100%">${mode === 'login' ? 'Log in' : 'Sign up'}</button>
      <p class="hint">${mode === 'login' ? "New here?" : "Have an account?"}
        <a href="#" id="sw">${mode === 'login' ? 'Sign up' : 'Log in'}</a></p></div>`;
    $('#sw').onclick = e => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); };
    const submit = async () => {
      try {
        const r = await api('/' + mode, 'POST', { username: $('#u').value, password: $('#p').value });
        token = r.token; me = r.username;
        localStorage.setItem('token', token); localStorage.setItem('username', me);
        location.hash = '#/'; route();
      } catch (e) { $('#err').textContent = e.message; }
    };
    $('#go').onclick = submit;
    $('#p').onkeydown = e => e.key === 'Enter' && submit();
  };
  draw();
}

function postHTML(p) {
  return `<div class="card post" data-id="${p.id}">
    <div class="row"><a href="#/u/${esc(p.username)}"><b>@${esc(p.username)}</b></a>
      <span class="meta">${ago(p.created_at)}</span></div>
    <div class="post-body">${esc(p.content)}</div>
    <div class="actions">
      <button class="act like ${p.liked ? 'on' : ''}">${p.liked ? '♥' : '♡'} <span>${p.likes}</span></button>
      <button class="act cmt">💬 <span>${p.comments}</span></button>
      ${p.mine ? '<button class="act del">Delete</button>' : ''}
    </div>
    <div class="comments" hidden></div></div>`;
}

function bindPosts(container, reload) {
  container.querySelectorAll('.post').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.like').onclick = async e => {
      const b = e.currentTarget, r = await api(`/posts/${id}/like`, 'POST');
      b.classList.toggle('on', r.liked);
      b.innerHTML = `${r.liked ? '♥' : '♡'} <span>${r.likes}</span>`;
    };
    const del = el.querySelector('.del');
    if (del) del.onclick = async () => { if (confirm('Delete this post?')) { await api('/posts/' + id, 'DELETE'); reload(); } };
    const box = el.querySelector('.comments');
    const loadComments = async () => {
      const list = await api(`/posts/${id}/comments`);
      box.innerHTML = list.map(c => `<div class="comment"><a href="#/u/${esc(c.username)}"><b>@${esc(c.username)}</b></a>
        <span class="meta">${ago(c.created_at)}</span><div>${esc(c.content)}</div></div>`).join('') +
        `<div class="row" style="margin-top:8px"><input placeholder="Write a comment…" maxlength="200" style="margin:0"><button>Send</button></div>`;
      el.querySelector('.cmt span').textContent = list.length;
      const input = box.querySelector('input'), send = async () => {
        if (!input.value.trim()) return;
        await api(`/posts/${id}/comments`, 'POST', { content: input.value });
        await loadComments(); box.querySelector('input').focus();
      };
      box.querySelector('button').onclick = send;
      input.onkeydown = e => e.key === 'Enter' && send();
    };
    el.querySelector('.cmt').onclick = async () => {
      box.hidden = !box.hidden;
      if (!box.hidden) await loadComments();
    };
  });
}

async function homeView() {
  app.innerHTML = `<div class="card"><textarea id="txt" maxlength="280" placeholder="What's on your mind?"></textarea>
      <div class="row"><span class="meta" id="cnt">0/280</span><button id="post">Post</button></div></div>
    <div class="card" id="sugg" hidden></div>
    <div class="tabs"><button data-s="following">Following</button><button data-s="all">Everyone</button></div>
    <div id="feed"></div>`;
  $('#txt').oninput = e => $('#cnt').textContent = e.target.value.length + '/280';
  $('#post').onclick = async () => {
    if (!$('#txt').value.trim()) return;
    await api('/posts', 'POST', { content: $('#txt').value });
    $('#txt').value = ''; $('#cnt').textContent = '0/280'; loadFeed();
  };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { feedScope = b.dataset.s; loadFeed(); });

  const sug = await api('/suggestions');
  if (sug.length) {
    $('#sugg').hidden = false;
    $('#sugg').innerHTML = '<b>Who to follow</b><br>' + sug.map(u => `<a href="#/u/${esc(u.username)}" class="meta" style="margin-right:12px">@${esc(u.username)}</a>`).join('');
  }
  async function loadFeed() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.s === feedScope));
    const posts = await api('/posts?scope=' + feedScope);
    $('#feed').innerHTML = posts.length ? posts.map(postHTML).join('')
      : `<p class="hint">${feedScope === 'following' ? 'Nothing here yet. Follow people or check "Everyone".' : 'No posts yet. Be the first!'}</p>`;
    bindPosts($('#feed'), loadFeed);
  }
  loadFeed();
}

async function profileView(name) {
  let u;
  try { u = await api('/users/' + encodeURIComponent(name)); }
  catch (e) { app.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
  app.innerHTML = `<div class="card">
      <div class="row"><div class="avatar">${esc(u.username[0].toUpperCase())}</div>
        <div id="btnArea"></div></div>
      <h2 style="margin-top:12px">@${esc(u.username)}</h2>
      <div id="bioArea"></div>
      <div class="stats"><div><b>${u.posts}</b>Posts</div><div><b id="fc">${u.followers}</b>Followers</div><div><b>${u.following}</b>Following</div></div>
      <span class="meta">Joined ${new Date(u.joined + 'Z').toLocaleDateString()}</span></div>
    <div id="feed"></div>`;

  if (u.isMe) {
    $('#bioArea').innerHTML = `<textarea id="bio" maxlength="160" placeholder="Write a short bio…">${esc(u.bio)}</textarea>
      <button id="saveBio" class="ghost">Save bio</button>`;
    $('#saveBio').onclick = async () => { await api('/me', 'PUT', { bio: $('#bio').value }); $('#saveBio').textContent = 'Saved ✓'; };
  } else {
    $('#bioArea').innerHTML = `<p>${esc(u.bio) || '<span class="meta">No bio yet.</span>'}</p>`;
    const btn = document.createElement('button');
    const setBtn = f => { btn.textContent = f ? 'Following ✓' : 'Follow'; btn.className = f ? 'ghost' : ''; };
    setBtn(u.isFollowing);
    btn.onclick = async () => {
      const r = await api(`/users/${encodeURIComponent(name)}/follow`, 'POST');
      setBtn(r.following); $('#fc').textContent = +$('#fc').textContent + (r.following ? 1 : -1);
    };
    $('#btnArea').append(btn);
  }
  const load = async () => {
    const posts = await api('/posts?user=' + encodeURIComponent(name));
    $('#feed').innerHTML = posts.length ? posts.map(postHTML).join('') : '<p class="hint">No posts yet.</p>';
    bindPosts($('#feed'), load);
  };
  load();
}

// ---------- Router ----------
function route() {
  if (!token) return authView();
  $('#nav').hidden = false;
  $('#myProfile').href = '#/u/' + me;
  const m = location.hash.match(/^#\/u\/(.+)$/);
  m ? profileView(decodeURIComponent(m[1])) : homeView();
}
window.addEventListener('hashchange', route);
route();
