# LifeCraft API

Node.js and Express API starter connected to MongoDB with Mongoose.

## Requirements

- Node.js 20.19 or later
- MongoDB running locally, or a MongoDB connection URI

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB URI.

3. Start the API in development mode with automatic restarts:

   ```sh
   npm run dev
   ```

   For a regular start, run `npm start`.

The API listens on port `3000` by default (configurable with `PORT`). It exposes
`GET /` and `GET /api/health`.
