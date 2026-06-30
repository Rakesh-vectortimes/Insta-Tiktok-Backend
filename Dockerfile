FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir -U yt-dlp curl_cffi

ENV YTDLP_IMPERSONATE=chrome

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p temp

EXPOSE 4000

CMD ["npm", "start"]
