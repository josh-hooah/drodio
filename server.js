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

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  socket.on('register', (username) => {
    users.set(socket.id, { username, socketId: socket.id });
    io.emit('user-list', Array.from(users.values()));
    console.log(`${username} registered`);
  });

  socket.on('call', (data) => {
    const { to, offer } = data;
    io.to(to).emit('incoming-call', {
      from: socket.id,
      fromUsername: users.get(socket.id)?.username,
      offer
    });
    console.log(`Call from ${socket.id} to ${to}`);
  });

  socket.on('accept-call', (data) => {
    const { to, answer } = data;
    io.to(to).emit('call-accepted', {
      from: socket.id,
      answer
    });
    console.log(`${socket.id} accepted call from ${to}`);
  });

  socket.on('ice-candidate', (data) => {
    const { to, candidate } = data;
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  socket.on('reject-call', (data) => {
    const { to } = data;
    io.to(to).emit('call-rejected', {
      from: socket.id
    });
    console.log(`${socket.id} rejected call from ${to}`);
  });

  socket.on('end-call', (data) => {
    const { to } = data;
    io.to(to).emit('call-ended', {
      from: socket.id
    });
    console.log(`${socket.id} ended call with ${to}`);
  });

  socket.on('disconnect', () => {
    const username = users.get(socket.id)?.username;
    users.delete(socket.id);
    io.emit('user-list', Array.from(users.values()));
    console.log(`${username} disconnected`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
