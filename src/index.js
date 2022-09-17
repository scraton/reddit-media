const express = require('express');
const fetch = require('node-fetch');
const morgan = require('morgan');
const xml = require('xml');

const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3234;
const POSTS_REQUEST_LIMIT = process.env.POSTS_REQUEST_LIMIT || 50;

const buildBaseUrl = (base, subreddit, category) => {
  switch (category) {
    case 'new':    return new URL(`${base}/${subreddit}/new.json`);
    case 'top':    return new URL(`${base}/${subreddit}/top.json`);
    case 'rising': return new URL(`${base}/${subreddit}/rising.json`);
    case 'hot':    return new URL(`${base}/${subreddit}/hot.json`);
    default:       return new URL(`${base}/${subreddit}/hot.json`);
  }
};

const buildRedditUrl = (base, subreddit, category, query) => {
  const url = buildBaseUrl(base, subreddit, category);
  url.searchParams.set('limit', POSTS_REQUEST_LIMIT);

  if (category === 'new') {
    url.searchParams.set('sort', 'new');
  } else if (category === 'top') {
    url.searchParams.set('sort', 'top');
  }

  if (query) {
    Object.keys(query).forEach((k) => url.searchParams.set(k, query[k]));
  }

  return url;
};

const extractVideoID = (source) => {
  const videoIDRegex = /(?:v\/|embed\/|[\/&\?]v=)([^#\&\?]+)/gi;
  const match = videoIDRegex.exec(source);
  if (!match) {
    return undefined;
  }

  return match[1];
};

const extractVideoEmbed = (source) => {
  const videoID = extractVideoID(source);
  const startRegex = /start=([0-9]+)/gi;
  const endRegex = /end=([0-9]+)/gi;

  let start = 0;
  let end = 0;

  let tmp_exec = startRegex.exec(source);
  if (tmp_exec) {
    start = parseInt(tmp_exec[1]);
  }

  tmp_exec = endRegex.exec(source);
  if (tmp_exec) {
    end = parseInt(tmp_exec[1]);
  }

  return { videoID, start, end };
};

const makeYoutubeLink = ({ videoID, start, end }) => {
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', videoID);

  if (start > 0 && end > 0) {
    url.searchParams.set('start', start);
    url.searchParams.set('end', start);
  } else if (start > 0) {
    url.searchParams.set('t', start);
  }

  return url.toString();
};

app.use(morgan('combined'));

app.get('/', (req, res) => {
  res.send('Hello, world.');
});

app.get('/r/:subreddit/:category?', async (req, res) => {
  const url = buildRedditUrl('https://www.reddit.com/r', req.params.subreddit, req.params.category, req.query);
  const result = await fetch(url.toString());
  const body = await result.json();
  let latestPostDate;

  const posts = body.data.children.map(({ data: post }) => {
    const title = post.title.replace(/\[[^\]]+\]/gi, '').trim();
    const thumbnail = post.thumbnail;
    const pubDate = new Date(post.created_utc * 1000);
    const summary = post.selftext;
    const category = post.link_flair_text;
    
    if (latestPostDate === undefined || pubDate > latestPostDate) {
      latestPostDate = pubDate;
    }

    if (!title || post.score === 0) {
      return undefined;
    }

    return {
      id: post.url,
      title,
      updated: pubDate.toISOString(),
      author: [
        { name: post.author },
      ],
      link: [
        {
          _attr: {
            rel: 'alternate',
            href: post.url,
          },
        }
      ],
      category: category ? [
        {
          _attr: {
            term: category,
          },
        },
      ] : undefined,
      summary,
    };
  });

  const fullURL = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const atom = {
    feed: [
      {
        _attr: {
          xmlns: 'http://www.w3.org/2005/Atom',
        },
      },
      {
        id: fullURL,
      },
      {
        title: `/r/${req.params.subreddit}`,
      },
      {
        link: {
          _attr: {
            rel: 'self',
            href: fullURL,
          },
        },
      },
      {
        updated: latestPostDate.toISOString(),
      },
      ...posts.filter((v) => Boolean(v)).map((post) => ({
        entry: Object.keys(post).map((k) => ({
          [k]: post[k]
        })),
      })),
    ],
  };

  res.set('Content-Type', 'application/atom+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>${xml(atom)}`);
});

app.get('/haiku/:category?', async (req, res) => {
  const url = buildRedditUrl('https://www.reddit.com/r', 'youtubehaiku', req.params.category, req.query);
  const result = await fetch(url.toString());
  const body = await result.json();

  const videos = body.data.children.map(({ data: post }) => {
    let embed;

    try {
      const { media } = post;
      const { oembed } = media || {};

      let source = (oembed || {}).html || (oembed || {}).url || post.url;
      source = source
        .replace(/%2f/gi, '/')
        .replace(/%3d/gi, '=')
        .replace(/%26/gi, '&')
        .replace(/%3f/gi, '?');

      embed = extractVideoEmbed(source);
    } catch (ex) {
      console.log(post);
      console.error(ex);
      return undefined;
    }

    if (!embed || post.score === 0) {
      return undefined;
    }

    const title = post.title.replace(/\[[^\]]+\]/gi, '').trim();
    const thumbnail = post.thumbnail;

    return {
      title,
      thumbnail,
      date: new Date(post.created_utc * 1000),
      url: makeYoutubeLink(embed),
    };
  });

  const rss = {
    rss: [
      {
        _attr: {
          version: '2.0',
          'xmlns:atom': 'http://www.w3.org/2005/Atom',
        },
      },
      {
        channel: [
          {
            'atom:link': {
              _attr: {
                href: `http://${HOST}:${PORT}/haiku/${req.params.category}`,
                rel: 'self',
                type: 'application/rss+xml',
              },
            },
          },
          {
            title: 'Youtube Haiku',
          },
          {
            link: url.toString(),
          },
          ...videos.filter(v => !!v).map((video) => ({
            item: [
              { title: video.title },
              { pubDate: video.date.toUTCString() },
              { link: video.url },
              { guid: video.url },
            ],
          })),
        ],
      },
    ],
  };

  res.set('Content-Type', 'application/rss+xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>${xml(rss)}`);
});

const server = app.listen(PORT, () => {
  console.log(`🚀 listening on port ${PORT}`);
});

process.on('SIGINT', () => {
  server.close(() => console.log('😢 Goodbye.'));
});

process.on('SIGTERM', () => {
  server.close(() => console.log('😢 Goodbye.'));
});
