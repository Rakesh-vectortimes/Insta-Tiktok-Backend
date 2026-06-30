const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Instagram & TikTok Downloader API',
      version: '1.0.0',
      description:
        'API for downloading Instagram reels, posts, stories, profile pictures, and TikTok videos, audio, and slideshows. Requires **yt-dlp** and **ffmpeg** on the server.',
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Local development' },
    ],
    tags: [
      { name: 'Health', description: 'Server health' },
      { name: 'Instagram', description: 'Instagram download endpoints' },
      { name: 'TikTok', description: 'TikTok download endpoints' },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'URL required' },
          },
        },
        UrlBody: {
          type: 'object',
          required: ['url'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://www.tiktok.com/@user/video/1234567890',
            },
            format: {
              type: 'string',
              enum: ['mp4', 'mp3'],
              default: 'mp4',
            },
            quality: {
              type: 'string',
              enum: ['360', '720', '1080', '360p', '720p', '1080p'],
              default: '720',
            },
          },
        },
        InstagramUrlBody: {
          type: 'object',
          required: ['url'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://www.instagram.com/reel/ABC123/',
            },
            sessionid: {
              type: 'string',
              description: 'Optional — only needed for private content or when Instagram rate-limits anonymous requests',
            },
            format: {
              type: 'string',
              enum: ['mp4', 'mp3'],
              default: 'mp4',
              description: 'Download format (default: mp4)',
            },
            quality: {
              type: 'string',
              enum: ['360', '720', '1080', '360p', '720p', '1080p'],
              default: '720',
              description: 'Video quality (default: 720p)',
            },
          },
        },
        StoryBody: {
          type: 'object',
          required: ['url', 'sessionid'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://www.instagram.com/stories/username/1234567890/',
            },
            sessionid: {
              type: 'string',
              description: 'Instagram sessionid cookie value',
            },
          },
        },
        CarouselZipBody: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://www.instagram.com/p/DWxgTK9mEDw/',
              description: 'Instagram carousel post URL (easiest — auto-fetches all slides)',
            },
            urls: {
              type: 'array',
              description: 'Or pass direct CDN URLs from POST /post response',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string', format: 'uri' },
                  ext: { type: 'string', example: 'jpg' },
                },
              },
            },
          },
        },
        ReelResponse: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            thumbnail: { type: 'string', format: 'uri' },
            duration: { type: 'number' },
            formats: { type: 'array', items: { type: 'string', enum: ['mp4', 'mp3'] } },
            qualities: { type: 'array', items: { type: 'string', example: '720p' } },
            downloadUrl: { type: 'string', description: 'Default download URL (format=mp4, quality=720)' },
            downloads: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  format: { type: 'string', enum: ['mp4', 'mp3'] },
                  quality: { type: 'integer', example: 720 },
                  label: { type: 'string', example: '720p MP4' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        PostResponse: {
          oneOf: [
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['image', 'video'] },
                url: { type: 'string', format: 'uri' },
                thumbnail: { type: 'string', format: 'uri' },
                ext: { type: 'string' },
                title: { type: 'string' },
              },
            },
            {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['carousel'] },
                count: { type: 'integer' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      index: { type: 'integer' },
                      url: { type: 'string' },
                      thumbnail: { type: 'string' },
                      ext: { type: 'string' },
                      type: { type: 'string', enum: ['image', 'video'] },
                    },
                  },
                },
              },
            },
          ],
        },
        DpResponse: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            fullName: { type: 'string' },
            dpUrl: { type: 'string', format: 'uri' },
            isPrivate: { type: 'boolean' },
            followers: { type: 'integer' },
          },
        },
        TikTokVideoResponse: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            author: { type: 'string' },
            thumbnail: { type: 'string', format: 'uri' },
            duration: { type: 'number' },
            views: { type: 'integer' },
            formats: { type: 'array', items: { type: 'string', enum: ['mp4', 'mp3'] } },
            qualities: { type: 'array', items: { type: 'string', example: '720p' } },
            downloadUrl: { type: 'string' },
            downloads: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  format: { type: 'string' },
                  quality: { type: 'integer' },
                  label: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        SlideshowResponse: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['slideshow'] },
            count: { type: 'integer' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            audio: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    paths: {
      '/health': {
        get: {
          tags: ['Health'],
          summary: 'Health check',
          responses: {
            200: {
              description: 'Server is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { status: { type: 'string', example: 'ok' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/instagram/reel': {
        post: {
          tags: ['Instagram'],
          summary: 'Get reel metadata',
          description: 'Tries GraphQL scraper first (no auth), falls back to yt-dlp. sessionid optional.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/InstagramUrlBody' } },
            },
          },
          responses: {
            200: {
              description: 'Reel metadata with download options',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ReelResponse' } },
              },
            },
            400: { description: 'Missing URL or invalid format/quality', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            500: { description: 'Download failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/instagram/reel/stream': {
        get: {
          tags: ['Instagram'],
          summary: 'Download reel (MP4 or MP3)',
          description: 'Streams reel as MP4 or extracts MP3. Use quality 360, 720, or 1080.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'Instagram reel URL',
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['mp4', 'mp3'], default: 'mp4' },
            },
            {
              name: 'quality',
              in: 'query',
              schema: { type: 'string', enum: ['360', '720', '1080', '360p', '720p', '1080p'], default: '720' },
            },
            {
              name: 'sessionid',
              in: 'query',
              schema: { type: 'string' },
              description: 'Optional Instagram sessionid cookie',
            },
          ],
          responses: {
            200: {
              description: 'MP4 or MP3 file',
              content: {
                'video/mp4': { schema: { type: 'string', format: 'binary' } },
                'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'Missing URL or invalid format/quality' },
            500: { description: 'Stream failed' },
          },
        },
      },
      '/api/instagram/post': {
        post: {
          tags: ['Instagram'],
          summary: 'Get post metadata',
          description: 'Public posts via GraphQL scraper first, yt-dlp fallback. sessionid optional.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/InstagramUrlBody' } },
            },
          },
          responses: {
            200: {
              description: 'Post metadata',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PostResponse' } },
              },
            },
            400: { description: 'Missing URL' },
            500: { description: 'Fetch failed' },
          },
        },
      },
      '/api/instagram/carousel/zip': {
        post: {
          tags: ['Instagram'],
          summary: 'Download carousel as ZIP',
          description: 'Pass Instagram post url OR urls array from POST /post. Works for image carousels.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CarouselZipBody' } },
            },
          },
          responses: {
            200: {
              description: 'ZIP archive',
              content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
            },
            400: { description: 'Invalid URLs array' },
            500: { description: 'ZIP creation failed' },
          },
        },
      },
      '/api/instagram/dp/{username}': {
        get: {
          tags: ['Instagram'],
          summary: 'Get profile picture (DP)',
          parameters: [
            {
              name: 'username',
              in: 'path',
              required: true,
              schema: { type: 'string', example: 'instagram' },
            },
          ],
          responses: {
            200: {
              description: 'Profile info',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/DpResponse' } },
              },
            },
            500: { description: 'Profile fetch failed' },
          },
        },
      },
      '/api/instagram/story': {
        post: {
          tags: ['Instagram'],
          summary: 'Get story metadata',
          description: 'Stories require login. Pass sessionid or set INSTAGRAM_COOKIES_BROWSER / cookies.txt.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['url'],
                  properties: {
                    url: { type: 'string', format: 'uri' },
                    sessionid: {
                      type: 'string',
                      description: 'Required unless INSTAGRAM_COOKIES_BROWSER or cookies.txt is configured',
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Story metadata',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/ReelResponse' } },
              },
            },
            401: { description: 'No Instagram auth configured (stories require login)' },
            500: { description: 'Fetch failed' },
          },
        },
      },
      '/api/tiktok/video': {
        post: {
          tags: ['TikTok'],
          summary: 'Get TikTok video metadata',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UrlBody' } },
            },
          },
          responses: {
            200: {
              description: 'Video metadata',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/TikTokVideoResponse' } },
              },
            },
            400: { description: 'Missing URL' },
            500: { description: 'Fetch failed' },
          },
        },
      },
      '/api/tiktok/video/stream': {
        get: {
          tags: ['TikTok'],
          summary: 'Download TikTok video (MP4 or MP3)',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['mp4', 'mp3'], default: 'mp4' },
            },
            {
              name: 'quality',
              in: 'query',
              schema: { type: 'string', enum: ['360', '720', '1080', '360p', '720p', '1080p'], default: '720' },
            },
          ],
          responses: {
            200: {
              description: 'MP4 or MP3 file',
              content: {
                'video/mp4': { schema: { type: 'string', format: 'binary' } },
                'audio/mpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'Missing URL or invalid format/quality' },
            500: { description: 'Stream failed' },
          },
        },
      },
      '/api/tiktok/audio': {
        post: {
          tags: ['TikTok'],
          summary: 'Extract audio as MP3',
          description: 'Downloads video and extracts audio via ffmpeg. Response is an MP3 file.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UrlBody' } },
            },
          },
          responses: {
            200: {
              description: 'MP3 audio file',
              content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
            },
            400: { description: 'Missing URL' },
            500: { description: 'Extraction failed' },
          },
        },
      },
      '/api/tiktok/slideshow': {
        post: {
          tags: ['TikTok'],
          summary: 'Get slideshow image URLs',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/UrlBody' } },
            },
          },
          responses: {
            200: {
              description: 'Slideshow images',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/SlideshowResponse' } },
              },
            },
            400: { description: 'Missing URL' },
            500: { description: 'Fetch failed' },
          },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
