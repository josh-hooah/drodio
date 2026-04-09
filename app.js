const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let broadcaster = null; // person sending stream
let coHost = null;      // second speaker

// Serve frontend
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>1-to-Many Stream</title>
  <style>
    video { width: 45%; }
    #chat { height:150px; overflow:auto; border:1px solid #ccc; }
  </style>
</head>
<body>

<h2>Live Stream</h2>

<input id="username" placeholder="Enter name"/>
<button onclick="join()">Join</button>
<button onclick="startStream()">Start Stream</button>

<br/><br/>

<video id="localVideo" autoplay muted></video>
<video id="remoteVideo" autoplay></video>

<h3>Chat</h3>
<div id="chat"></div>
<input id="msg" placeholder="message"/>
<button onclick="sendMsg()">Send</button>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();

let pc;
let localStream;
let username;
let isBroadcaster = false;

const iceServers = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// JOIN
function join() {
  username = document.getElementById('username').value;
  socket.emit('join', username);
}

// START STREAM (only 1 main broadcaster)
async function startStream() {
  isBroadcaster = true;

  localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  document.getElementById('localVideo').srcObject = localStream;

  socket.emit('broadcaster');
}

// VIEWER receives stream
socket.on('watcher', async (id) => {
  pc = new RTCPeerConnection(iceServers);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('candidate', id, e.candidate);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('offer', id, pc.localDescription);
});

// VIEWER SIDE
socket.on('offer', async (id, description) => {
  pc = new RTCPeerConnection(iceServers);

  pc.ontrack = e => {
    document.getElementById('remoteVideo').srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('candidate', id, e.candidate);
    }
  };

  await pc.setRemoteDescription(description);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('answer', id, pc.localDescription);
});

socket.on('answer', (id, description) => {
  pc.setRemoteDescription(description);
});

socket.on('candidate', (id, candidate) => {
  pc.addIceCandidate(new RTCIceCandidate(candidate));
});

// CHAT
function sendMsg() {
  const msg = document.getElementById('msg').value;
  socket.emit('chat', username + ": " + msg);
}

socket.on('chat', msg => {
  const div = document.getElementById('chat');
  div.innerHTML += "<p>" + msg + "</p>";
});

</script>
</body>
</html>
`);
});

// SOCKET LOGIC
io.on('connection', socket => {

  socket.on('join', (username) => {
    socket.username = username;
  });

  // broadcaster starts
  socket.on('broadcaster', () => {
    broadcaster = socket.id;
  });

  // viewer joins
  socket.on('watcher', () => {
    if (broadcaster) {
      io.to(broadcaster).emit('watcher', socket.id);
    }
  });

  socket.on('offer', (id, message) => {
    io.to(id).emit('offer', socket.id, message);
  });

  socket.on('answer', (id, message) => {
    io.to(id).emit('answer', socket.id, message);
  });

  socket.on('candidate', (id, message) => {
    io.to(id).emit('candidate', socket.id, message);
  });

  // CHAT
  socket.on('chat', msg => {
    io.emit('chat', msg);
  });

  socket.on('disconnect', () => {
    if (socket.id === broadcaster) {
      broadcaster = null;
    }
  });
});

server.listen(3000, () => console.log("Server running on http://localhost:3000"));