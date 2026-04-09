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

// Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Initialize
function init() {
  roleInputs.forEach(input => {
    input.addEventListener('change', () => {
      isHost = input.value === 'host';
      updateUI();
    });
  });

  joinStreamBtn.addEventListener('click', joinStream);
  toggleVideoBtn.addEventListener('click', toggleVideo);
  toggleAudioBtn.addEventListener('click', toggleAudio);
  startStreamBtn.addEventListener('click', startStream);
  endStreamBtn.addEventListener('click', endStream);
  switchCameraBtn.addEventListener('click', switchCamera);
  sendChatBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  updateUI();
}

function updateUI() {
  const controls = document.getElementById('controls');
  if (isHost) {
    controls.style.display = 'flex';
    startStreamBtn.style.display = 'inline-block';
    endStreamBtn.style.display = 'inline-block';
  } else {
    controls.style.display = 'none';
  }
}

async function joinStream() {
  username = usernameInput.value.trim() || 'Anonymous';
  socket.emit('register', { username, isHost });

  if (isHost) {
    await getLocalStream();
  } else {
    // Viewer requests stream if active
    socket.emit('request-stream');
  }

  statusDiv.textContent = 'Joined';
  statusDiv.className = 'status status-connected';
  joinStreamBtn.disabled = true;
}

async function getLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
    toggleVideoBtn.classList.remove('inactive');
    toggleVideoBtn.classList.add('active');
    toggleAudioBtn.classList.remove('inactive');
    toggleAudioBtn.classList.add('active');
  } catch (error) {
    console.error('Error accessing media devices:', error);
    alert('Could not access camera/microphone');
  }
}

function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleVideoBtn.classList.toggle('active', videoTrack.enabled);
      toggleVideoBtn.classList.toggle('inactive', !videoTrack.enabled);
    }
  }
}

function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleAudioBtn.classList.toggle('active', audioTrack.enabled);
      toggleAudioBtn.classList.toggle('inactive', !audioTrack.enabled);
    }
  }
}

async function startStream() {
  if (!localStream || !isHost) return;

  isStreaming = true;
  startStreamBtn.disabled = true;
  endStreamBtn.disabled = false;

  // Notify server that stream started
  socket.emit('start-stream');

  statusDiv.textContent = 'Streaming';

  // Create offers for existing viewers
  const viewers = users.filter(user => !user.isHost && user.socketId !== socket.id);
  for (const viewer of viewers) {
    await createOfferForViewer(viewer.socketId);
  }
}

function endStream() {
  isStreaming = false;
  startStreamBtn.disabled = false;
  endStreamBtn.disabled = true;

  // Close all peer connections
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};

  socket.emit('end-stream');
  statusDiv.textContent = 'Ready';
  statusDiv.className = 'status status-idle';
}

async function switchCamera() {
  if (!localStream) return;

  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');

    if (videoDevices.length > 1) {
      // Simple switch - in real app, would track current device
      localStream.getVideoTracks().forEach(track => track.stop());
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: videoDevices[1].deviceId },
        audio: true
      });
      localStream = newStream;
      localVideo.srcObject = localStream;
    }
  }
}

function sendChat() {
  const message = chatInput.value.trim();
  if (message) {
    socket.emit('chat', { message, username });
    chatInput.value = '';
  }
}

// Socket event handlers
socket.on('user-list', (userListData) => {
  users = userListData;
  userList.innerHTML = '';
  userListData.forEach(user => {
    const li = document.createElement('li');
    li.className = 'user-item';
    if (user.socketId === socket.id) li.classList.add('self');
    li.textContent = user.username + (user.isHost ? ' (Host)' : ' (Viewer)');
    userList.appendChild(li);
  });
});

socket.on('stream-started', async (hostId) => {
  if (!isHost && hostId !== socket.id) {
    // Viewer joins the stream
    await createViewerConnection(hostId);
  }
});

socket.on('viewer-joined', async (viewerId) => {
  if (isHost && isStreaming) {
    await createOfferForViewer(viewerId);
  }
});

socket.on('stream-offer', async (data) => {
  if (!isHost) {
    const { from, offer } = data;
    await handleOffer(from, offer);
  }
});

socket.on('stream-answer', (data) => {
  if (isHost) {
    const { from, answer } = data;
    const pc = peerConnections[from];
    if (pc) {
      pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }
});

socket.on('ice-candidate', (data) => {
  const { from, candidate } = data;
  const pc = peerConnections[from];
  if (pc) {
    pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on('stream-ended', () => {
  if (!isHost) {
    remoteVideo.srcObject = null;
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    statusDiv.textContent = 'Stream ended';
    statusDiv.className = 'status status-idle';
  }
});

socket.on('chat', (data) => {
  const div = document.createElement('div');
  div.className = 'chat-message';
  div.textContent = `${data.username}: ${data.message}`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// WebRTC functions
async function createOfferForViewer(viewerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[viewerId] = pc;

  // Add local stream tracks
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: viewerId, candidate: event.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit('stream-offer', { to: viewerId, offer });
}

async function createViewerConnection(hostId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[hostId] = pc;

  pc.ontrack = (event) => {
    if (event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: hostId, candidate: event.candidate });
    }
  };

  // Request offer from host
  socket.emit('request-stream');
}

async function handleOffer(from, offer) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[from] = pc;

  pc.ontrack = (event) => {
    if (event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { to: from, candidate: event.candidate });
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('stream-answer', { to: from, answer });
}

// For host to send offers to viewers
async function sendOffersToViewers() {
  const users = Array.from(document.querySelectorAll('.user-item')).map(li => li.textContent);
  // Need to get viewer ids from server
  // For simplicity, assume server sends viewer list
}

init();