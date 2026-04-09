const socket = io();
let localStream;
let peerConnections = {};
let isHost = true;
let isStreaming = false;
let username = '';
let users = [];

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const usernameInput = document.getElementById('usernameInput');
const roleInputs = document.querySelectorAll('input[name="role"]');
const joinStreamBtn = document.getElementById('joinStream');
const toggleVideoBtn = document.getElementById('toggleVideo');
const toggleAudioBtn = document.getElementById('toggleAudio');
const startStreamBtn = document.getElementById('startStream');
const endStreamBtn = document.getElementById('endStream');
const switchCameraBtn = document.getElementById('switchCamera');
const statusDiv = document.getElementById('status');
const userList = document.getElementById('userList');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChat');


const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

function init() {
  roleInputs.forEach(input => {
    input.addEventListener('change', () => {
      isHost = input.value === 'host';
      updateUI();
    });
  });

  joinStreamBtn.onclick = joinStream;
  toggleVideoBtn.onclick = toggleVideo;
  toggleAudioBtn.onclick = toggleAudio;
  startStreamBtn.onclick = startStream;
  endStreamBtn.onclick = endStream;
  switchCameraBtn.onclick = switchCamera;
  sendChatBtn.onclick = sendChat;

  chatInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') sendChat();
  });

  updateUI();
}

function updateUI() {
  document.getElementById('controls').style.display = isHost ? 'flex' : 'none';
}

async function joinStream() {
  username = usernameInput.value.trim() || 'Anonymous';

  socket.emit('register', { username, isHost });

  if (isHost) {
    await getLocalStream();
  }

  statusDiv.textContent = 'Joined';
  joinStreamBtn.disabled = true;
}

async function getLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert('Camera/Mic error');
  }
}

function toggleVideo() {
  const track = localStream?.getVideoTracks()[0];
  if (track) track.enabled = !track.enabled;
}

function toggleAudio() {
  const track = localStream?.getAudioTracks()[0];
  if (track) track.enabled = !track.enabled;
}

async function startStream() {
  if (!localStream) return;

  isStreaming = true;
  socket.emit('start-stream');

  // Send to existing viewers
  users.forEach(user => {
    if (!user.isHost && user.socketId !== socket.id) {
      createOffer(user.socketId);
    }
  });

  statusDiv.textContent = 'Streaming';
}

function endStream() {
  isStreaming = false;

  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  socket.emit('end-stream');
  statusDiv.textContent = 'Stopped';
}

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;

  socket.emit('chat', { message: msg, username });
  chatInput.value = '';
}

// SOCKET EVENTS

socket.on('user-list', data => {
  users = data;

  userList.innerHTML = '';
  data.forEach(user => {
    const li = document.createElement('li');
    li.textContent = user.username + (user.isHost ? ' (Host)' : '');
    userList.appendChild(li);
  });
});

socket.on('viewer-joined', viewerId => {
  if (isHost && isStreaming) {
    createOffer(viewerId);
  }
});

socket.on('stream-started', hostId => {
  if (!isHost) {
    socket.emit('request-stream', { hostId });
  }
});

socket.on('stream-offer', async ({ from, offer }) => {
  if (isHost) return;

  const pc = createPeerConnection(from);

  await pc.setRemoteDescription(offer);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('stream-answer', { to: from, answer });
});

socket.on('stream-answer', async ({ from, answer }) => {
  const pc = peerConnections[from];
  if (!pc) return;

  await pc.setRemoteDescription(answer);
});

socket.on('ice-candidate', async ({ from, candidate }) => {
  const pc = peerConnections[from];
  if (!pc || !candidate) return;

  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    console.warn('ICE error', e);
  }
});

socket.on('stream-ended', () => {
  remoteVideo.srcObject = null;

  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  statusDiv.textContent = 'Stream ended';
});

socket.on('chat', data => {
  const div = document.createElement('div');
  div.textContent = `${data.username}: ${data.message}`;
  chatMessages.appendChild(div);
});

// WEBRTC CORE

function createPeerConnection(id) {
  if (peerConnections[id]) return peerConnections[id];

  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[id] = pc;

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('ice-candidate', { to: id, candidate: e.candidate });
    }
  };

  pc.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };

  if (isHost && localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  return pc;
}

async function createOffer(viewerId) {
  const pc = createPeerConnection(viewerId);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('stream-offer', {
    to: viewerId,
    offer
  });
}

// CAMERA SWITCH 
async function switchCamera() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter(d => d.kind === 'videoinput');

  if (cams.length < 2) return;

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: cams[1].deviceId },
    audio: true
  });

  localStream = newStream;
  localVideo.srcObject = newStream;
}

init();