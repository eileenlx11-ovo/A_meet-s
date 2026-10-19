require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { getDb } = require('./db');
const { attachUser } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const worksRoutes = require('./routes/works');
const imagesRoutes = require('./routes/images');
const profileRoutes = require('./routes/profile');
const communitiesRoutes = require('./routes/communities');
const { router: friendsRoutes } = require('./routes/friends');
const sharesRoutes = require('./routes/shares');

function createApp() {
  getDb();

  const app = express();
  const rootDir = path.join(__dirname, '..');

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api', worksRoutes);
  app.use('/api', imagesRoutes);
  app.use('/api', profileRoutes);
  app.use('/api', communitiesRoutes);
  app.use('/api', friendsRoutes);
  app.use('/api', sharesRoutes);

  // Keep the existing page URLs without exposing the database, source, or configuration.
  const pages = ['index.html', 'search.html', 'work.html', 'login.html', 'profile.html', 'community.html', 'friends.html'];
  app.get('/', (_req, res) => res.sendFile('index.html', { root: rootDir }));
  for (const page of pages) {
    app.get(`/${page}`, (_req, res) => res.sendFile(page, { root: rootDir }));
  }

  const staticOptions = { dotfiles: 'ignore', index: false, redirect: false };
  app.use('/css', express.static(path.join(rootDir, 'css'), staticOptions));
  app.use('/js', express.static(path.join(rootDir, 'js'), staticOptions));
  app.use('/assets/generated-images', express.static(path.join(rootDir, 'assets', 'generated-images'), staticOptions));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: '服务器暂时无法完成请求。' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Anchor & Shadow running at http://localhost:${port}`);
  });
}

module.exports = { createApp };
