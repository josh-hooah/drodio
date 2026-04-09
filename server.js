const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Store connected users
const users = new Map();
let streamHost = null;

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  socket.on('register', (data) => {
    const { username, isHost } = data;
    users.set(socket.id, { username, socketId: socket.id, isHost });
    if (isHost) {
      streamHost = socket.id;
    }
    io.emit('user-list', Array.from(users.values()));
    console.log(`${username} registered as ${isHost ? 'host' : 'viewer'}`);
  });

  socket.on('start-stream', () => {
    if (socket.id === streamHost) {
      io.emit('stream-started', socket.id);
      console.log('Stream started by host');
    }
  });

  socket.on('end-stream', () => {
    if (socket.id === streamHost) {
      io.emit('stream-ended');
      streamHost = null;
      console.log('Stream ended');
    }
  });

  socket.on('request-stream', () => {
    if (streamHost && streamHost !== socket.id) {
      // Tell host to send offer to this viewer
      io.to(streamHost).emit('viewer-joined', socket.id);
    }
  });

  socket.on('stream-offer', (data) => {
    const { to, offer } = data;
    io.to(to).emit('stream-offer', { from: socket.id, offer });
  });

  socket.on('stream-answer', (data) => {
    const { to, answer } = data;
    io.to(to).emit('stream-answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', (data) => {
    const { to, candidate } = data;
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('chat', (data) => {
    io.emit('chat', { ...data, socketId: socket.id });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      if (user.isHost && streamHost === socket.id) {
        streamHost = null;
        io.emit('stream-ended');
      }
      users.delete(socket.id);
      io.emit('user-list', Array.from(users.values()));
      console.log(`${user.username} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
