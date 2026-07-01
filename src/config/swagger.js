const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Instagram & TikTok Downloader API',
      version: '1.0.0',
      description:
        'Public-only API for downloading Instagram reels, posts, profile pictures, and TikTok videos, audio, and slideshows. No session cookies or login required. Private accounts and stories are not supported.',
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
            scopeLimited: { type: 'boolean', example: false },
            retryable: { type: 'boolean', example: false },
            reasonCode: {
              type: 'string',
              enum: [
                'private_or_story',
                'public_embed_video_stripped',
                'rate_limited',
                'stories_not_supported',
              ],
            },
            details: { type: 'string' },
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
          required: ['url'],
          properties: {
            url: {
              type: 'string',
              format: 'uri',
              example: 'https://www.instagram.com/stories/username/1234567890/',
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
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['image', 'video', 'carousel'] },
            url: { type: 'string', format: 'uri' },
            thumbnail: { type: 'string', format: 'uri' },
            ext: { type: 'string' },
            title: { type: 'string' },
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
                      downloadUrl: {
                        type: 'string',
                        description: 'Download this slide individually',
                        example:
                          '/api/instagram/carousel/slide?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F&index=1',
                      },
                    },
              },
            },
            downloadUrl: {
              type: 'string',
              description: 'Default download link (opens file in browser)',
              example: '/api/instagram/post/stream?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FABC%2F',
            },
            downloads: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  format: { type: 'string', example: 'mp4' },
                  quality: { type: 'integer', nullable: true, example: 720 },
                  label: { type: 'string', example: '720p MP4' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        DpResponse: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            fullName: { type: 'string' },
            dpUrl: { type: 'string', format: 'uri', description: 'Direct CDN image URL' },
            downloadUrl: {
              type: 'string',
              description: 'API path to download the profile picture as a file',
              example: '/api/instagram/dp/instagram/download',
            },
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
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      mode: { type: 'string', example: 'public-only' },
                      instagramCookies: { type: 'string', example: 'disabled (public-only)' },
                    },
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
          description: 'Public-only extraction via Instagram embed HTML. No session or cookies required.',
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
      '/api/instagram/post/stream': {
        get: {
          tags: ['Instagram'],
          summary: 'Download post (image, video, or single carousel slide)',
          description:
            'Streams a single image or video post. For carousels, pass index (1-based) or use GET /carousel/stream for ZIP.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'Instagram post URL',
            },
            {
              name: 'index',
              in: 'query',
              schema: { type: 'integer', minimum: 1 },
              description: 'Carousel slide number (1-based)',
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['mp4', 'mp3'], default: 'mp4' },
              description: 'Video posts only',
            },
            {
              name: 'quality',
              in: 'query',
              schema: { type: 'string', enum: ['360', '720', '1080'], default: '720' },
              description: 'Video posts only',
            },
          ],
          responses: {
            200: {
              description: 'Media file download',
              content: {
                'video/mp4': { schema: { type: 'string', format: 'binary' } },
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'Invalid URL or carousel index' },
            422: { description: 'Post not accessible' },
          },
        },
      },
      '/api/instagram/post': {
        post: {
          tags: ['Instagram'],
          summary: 'Get post metadata',
          description: 'Public-only extraction via Instagram embed HTML. No session or cookies required.',
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
      '/api/instagram/carousel/slide': {
        get: {
          tags: ['Instagram'],
          summary: 'Download a single carousel slide',
          description:
            'Streams one slide from a carousel post. index is 1-based (first slide = 1).',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'Instagram carousel post URL',
            },
            {
              name: 'index',
              in: 'query',
              required: true,
              schema: { type: 'integer', minimum: 1, example: 1 },
              description: 'Slide number (1 = first image)',
            },
            {
              name: 'format',
              in: 'query',
              schema: { type: 'string', enum: ['mp4', 'mp3'], default: 'mp4' },
              description: 'Video slides only',
            },
            {
              name: 'quality',
              in: 'query',
              schema: { type: 'string', enum: ['360', '720', '1080'], default: '720' },
              description: 'Video slides only',
            },
          ],
          responses: {
            200: {
              description: 'Slide file download',
              content: {
                'image/jpeg': { schema: { type: 'string', format: 'binary' } },
                'video/mp4': { schema: { type: 'string', format: 'binary' } },
              },
            },
            400: { description: 'Missing index or invalid slide' },
            422: { description: 'Post not accessible' },
          },
        },
      },
      '/api/instagram/carousel/stream': {
        get: {
          tags: ['Instagram'],
          summary: 'Download carousel as ZIP (link)',
          description: 'Same as POST /carousel/zip but usable as a GET download link from POST /post response.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
              description: 'Instagram carousel post URL',
            },
          ],
          responses: {
            200: {
              description: 'ZIP archive',
              content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
            },
            400: { description: 'Missing URL' },
            422: { description: 'Post not accessible' },
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
      '/api/instagram/dp/{username}/download': {
        get: {
          tags: ['Instagram'],
          summary: 'Download profile picture (DP)',
          description: 'Streams the profile picture as a JPEG file attachment.',
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
              description: 'Profile picture file',
              content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
            },
            500: { description: 'Profile fetch failed' },
            503: { description: 'Instagram blocked server IP (set IG_HTTP_PROXY)' },
          },
        },
      },
      '/api/instagram/dp/{username}': {
        get: {
          tags: ['Instagram'],
          summary: 'Get profile picture (DP) metadata',
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
          summary: 'Get story metadata (not supported)',
          description: 'Stories are not supported in public-only mode.',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StoryBody' } },
            },
          },
          responses: {
            422: {
              description: 'Stories not supported',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
          },
        },
      },
      '/api/instagram/story/stream': {
        get: {
          tags: ['Instagram'],
          summary: 'Download story (not supported)',
          description: 'Stories are not supported in public-only mode.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              schema: { type: 'string', format: 'uri' },
            },
          ],
          responses: {
            422: {
              description: 'Stories not supported',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
            },
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
