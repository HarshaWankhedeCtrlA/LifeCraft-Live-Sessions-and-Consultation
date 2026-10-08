require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/database');

connectDB()
  .then(() => {
    const server = http.createServer(app);
    require('./realtime/socket')(server);
    server.listen(process.env.PORT, () => console.log(`Sessions service on ${process.env.PORT}`));
    require('./workers').start();
  })
  .catch((e) => { console.error(e); process.exit(1); });