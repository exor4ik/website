// ═══════════════════════════════════════════════════════════
// 👥 GROUPS — Групповые чаты и звонки
// ═══════════════════════════════════════════════════════════

// ─── GROUP E2EE ────────────────────────────────────────────

async function encryptForGroup(text, members, myKeys) {
  const aesKey = await crypto.subtle.generateKey(AES_ALGO, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, enc.encode(text));
  const aesRaw = await crypto.subtle.exportKey('raw', aesKey);

  const encryptedKeys = {};
  for (const memberUid of members) {
    // ✅ FIX: Раньше currentUser.uid пропускался — свои сообщения нельзя было расшифровать.
    // Теперь шифруем и для себя, используя свой publicKey напрямую из myKeys.
    const pubKey = (memberUid === currentUser.uid)
      ? myKeys.publicKey
      : await getPublicKey(memberUid);

    if (!pubKey) {
      console.warn(`⚠️ Участник ${memberUid} не имеет E2EE ключей`);
      continue;
    }
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, aesRaw);
    encryptedKeys[memberUid] = bytesToBase64(new Uint8Array(encrypted));
  }

  return `v2:${textToBase64(JSON.stringify({
    v: 2,
    iv: bytesToBase64(iv),
    c: bytesToBase64(new Uint8Array(ciphertext)),
    k: encryptedKeys,
  }))}`;
}

async function decryptFromGroup(encrypted, myUid, privateKey) {
  const encodedPayload = String(encrypted || '').slice(3);
  const payload = parseJsonSafe(base64ToText(encodedPayload));
  if (!payload || payload.v !== 2 || !payload.k) throw new Error('Неверный формат группового сообщения');

  const wrappedKeyB64 = payload.k[myUid];
  if (!wrappedKeyB64) throw new Error('Ключ для этого пользователя не найден');

  const aesRaw = await crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    base64ToBytes(wrappedKeyB64)
  );
  const aesKey = await crypto.subtle.importKey('raw', aesRaw, AES_ALGO, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    aesKey,
    base64ToBytes(payload.c)
  );
  return new TextDecoder().decode(decrypted);
}

// ─── GROUP MANAGER ─────────────────────────────────────────

class GroupManager {
  constructor() {
    this.activeGroupId = null;
    this.groupListener = null;
    this.messagesListener = null;
    this.groupCache = {};
  }

  async createGroup(name, memberUids, avatar = null) {
    const me = currentUser;
    const members = [me.uid, ...memberUids.filter(u => u !== me.uid)];

    const groupRef = window.db.collection('groups').doc();
    const now = firebase.firestore.FieldValue.serverTimestamp();

    const memberData = {};
    for (const uid of members) {
      const user = await getUser(uid);
      memberData[uid] = { name: user.name, avatar: user.avatar };
    }

    await groupRef.set({
      name,
      avatar,
      members,
      memberNames: Object.fromEntries(members.map(u => [u, memberData[u].name])),
      memberAvatars: Object.fromEntries(members.map(u => [u, memberData[u].avatar])),
      createdBy: me.uid,
      createdAt: now,
      lastMessage: '',
      lastMessageAt: now,
      _encrypted: true,
      _e2ee: true,
      _cryptoVersion: 2,
    });

    return groupRef.id;
  }

  async addMember(groupId, uid) {
    const groupRef = window.db.collection('groups').doc(groupId);
    const user = await getUser(uid);

    await groupRef.update({
      members: firebase.firestore.FieldValue.arrayUnion(uid),
      [`memberNames.${uid}`]: user.name,
      [`memberAvatars.${uid}`]: user.avatar,
    });

    delete this.groupCache[groupId]; // ✅ Сбрасываем кэш
  }

  async removeMember(groupId, uid) {
    const groupRef = window.db.collection('groups').doc(groupId);
    await groupRef.update({
      members: firebase.firestore.FieldValue.arrayRemove(uid),
      [`memberNames.${uid}`]: firebase.firestore.FieldValue.delete(),
      [`memberAvatars.${uid}`]: firebase.firestore.FieldValue.delete(),
    });

    delete this.groupCache[groupId]; // ✅ Сбрасываем кэш
  }

  // ✅ NEW: Удаление группы со всеми сообщениями
  async deleteGroup(groupId) {
    if (this.activeGroupId === groupId) {
      this.unsubscribe();
      this.activeGroupId = null;
    }

    const groupRef = window.db.collection('groups').doc(groupId);

    // Удаляем сообщения чанками (лимит batch — 500)
    const messagesSnap = await groupRef.collection('messages').get();
    if (!messagesSnap.empty) {
      for (let i = 0; i < messagesSnap.docs.length; i += 499) {
        const batch = window.db.batch();
        messagesSnap.docs.slice(i, i + 499).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }

    await groupRef.delete();
    delete this.groupCache[groupId];
  }

  subscribeGroups(myUid, callback) {
    this.groupListener?.();
    this.groupListener = window.db.collection('groups')
      .where('members', 'array-contains', myUid)
      .orderBy('lastMessageAt', 'desc')
      .onSnapshot(snap => {
        const groups = [];
        snap.forEach(doc => {
          const data = doc.data();
          groups.push({ id: doc.id, ...data });
          this.groupCache[doc.id] = data;
        });
        callback(groups);
      }, err => {
        console.error('❌ Groups subscription:', err);
      });
  }

  async getGroup(groupId) {
    if (this.groupCache[groupId]) return this.groupCache[groupId];
    const doc = await window.db.collection('groups').doc(groupId).get();
    if (!doc.exists) return null;
    const data = doc.data();
    this.groupCache[groupId] = data;
    return data;
  }

  async sendMessage(groupId, text, imageDataUrl = null) {
    const me = currentUser;
    const group = await this.getGroup(groupId);
    if (!group) throw new Error('Группа не найдена');

    const myKeys = await getOrCreateKeys();
    const members = group.members;

    let encryptedText = text;
    let encryptedImage = imageDataUrl;
    let isEncrypted = false;

    try {
      if (text) {
        encryptedText = await encryptForGroup(text, members, myKeys);
      }
      if (imageDataUrl) {
        encryptedImage = await encryptForGroup(imageDataUrl, members, myKeys);
      }
      isEncrypted = true;
    } catch (e) {
      console.error('❌ Group encrypt failed:', e);
      throw new Error('Не удалось зашифровать сообщение');
    }

    const groupRef = window.db.collection('groups').doc(groupId);
    const msgRef = groupRef.collection('messages').doc();
    const myName = userCache[me.uid]?.name || me.displayName || 'Вы';

    await window.db.runTransaction(async tx => {
      tx.set(msgRef, {
        senderUid: me.uid,
        senderName: myName,
        text: encryptedText,
        image: encryptedImage || null,
        _hasImage: !!imageDataUrl,
        _encrypted: isEncrypted,
        _e2ee: isEncrypted,
        _cryptoVersion: 2,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        read: false,
      });

      tx.update(groupRef, {
        lastMessage: imageDataUrl
          ? (text ? '🖼️ Изображение и текст' : '🖼️ Изображение')
          : (isEncrypted ? '🔐 Зашифрованное сообщение' : text),
        lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastMessageBy: me.uid,
      });
    });
  }

  subscribeMessages(groupId, myUid, callback) {
    this.messagesListener?.();
    const groupRef = window.db.collection('groups').doc(groupId);

    this.messagesListener = groupRef.collection('messages')
      .orderBy('createdAt', 'asc')
      .onSnapshot(async snap => {
        const messages = [];
        const myKeys = await getOrCreateKeys();

        // ✅ Предзагрузка данных всех уникальных отправителей (аватарки, имена)
        const uniqueSenders = [...new Set(snap.docs.map(d => d.data().senderUid).filter(Boolean))];
        await Promise.all(uniqueSenders.map(uid => userCache[uid] ? Promise.resolve() : getUser(uid)));

        for (const doc of snap.docs) {
          const rawMsg = doc.data();
          let msgText = rawMsg.text;
          let msgImage = rawMsg.image;

          if (rawMsg._encrypted || rawMsg._cryptoVersion === 2) {
            try {
              msgText = await decryptFromGroup(rawMsg.text, myUid, myKeys.privateKey);
              if (rawMsg.image) {
                msgImage = await decryptFromGroup(rawMsg.image, myUid, myKeys.privateKey);
              }
            } catch (e) {
              console.error('❌ Group message decrypt error:', e);
              msgText = '[Не удалось расшифровать сообщение]';
              msgImage = null;
            }
          }

          messages.push({
            id: doc.id,
            ...rawMsg,
            text: msgText,
            image: msgImage,
          });
        }

        callback(messages);
      }, err => {
        console.error('❌ Group messages:', err);
      });
  }

  unsubscribe() {
    this.groupListener?.();
    this.messagesListener?.();
    this.groupListener = null;
    this.messagesListener = null;
  }
}

const groupManager = new GroupManager();

// ─── GROUP CALL MANAGER (Mesh Topology) ────────────────────

class GroupCallManager {
  constructor() {
    this.currentCall = null;
    this.peerConnections = new Map();
    this.localStream = null;
    this.remoteStreams = new Map();
    this.signalListener = null;
    this.participantListener = null;
    this.callTimeout = null;
    this.isEnding = false;
    this.sounds = {};
    this.soundsLoaded = false;
    this.callStartTime = null;
    this.callTimerInterval = null;
    this.processedSignals = new Set();
  }

  loadSounds() {
    if (this.soundsLoaded) return;
    this.sounds = {
      outgoing: new Audio('sound/call_outgoing.ogg'),
      incoming: new Audio('sound/call_incoming.ogg'),
      connected: new Audio('sound/call_connected.ogg'),
      disconnected: new Audio('sound/call_disconnected.ogg'),
    };
    this.sounds.outgoing.loop = true;
    this.sounds.incoming.loop = true;
    this.soundsLoaded = true;
  }

  playSound(name) {
    this.loadSounds();
    const s = this.sounds[name];
    if (!s) return;
    s.currentTime = 0;
    s.play().catch(e => console.warn('Audio play blocked:', e));
  }

  stopSound(name) {
    const s = this.sounds[name];
    if (!s) return;
    s.pause();
    s.currentTime = 0;
  }

  stopAllSounds() {
    Object.keys(this.sounds).forEach(k => this.stopSound(k));
  }

  getIceConfig() {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ]
    };
  }

  async startGroupCall(groupId, groupName, memberUids) {
    if (this.currentCall) {
      alert('У вас уже идёт звонок. Завершите текущий.');
      return;
    }

    this.isEnding = false;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
      return;
    }

    const callId = window.db.collection('groupCalls').doc().id;
    this.currentCall = {
      callId,
      groupId,
      groupName,
      memberUids: memberUids.filter(u => u !== currentUser.uid),
      isInitiator: true,
    };

    await window.db.collection('groupCalls').doc(callId).set({
      groupId,
      groupName,
      memberUids,
      status: 'ringing',
      initiatorUid: currentUser.uid,
      initiatorName: userCache[currentUser.uid]?.name || 'Звонок',
      participants: {
        [currentUser.uid]: {
          joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
          status: 'active',
        }
      },
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    this.subscribeToCallDoc(callId);
    this.subscribeToParticipants(callId);

    for (const uid of this.currentCall.memberUids) {
      await this.createPeerConnection(callId, uid, true);
    }

    this.showOutgoingGroupCallUI(groupName, memberUids.length);
    this.playSound('outgoing');

    this.callTimeout = setTimeout(() => {
      if (this.currentCall && !this.isEnding) {
        this.endGroupCall('missed');
      }
    }, 45000);
  }

  async createPeerConnection(callId, remoteUid, isInitiator) {
    const pc = new RTCPeerConnection(this.getIceConfig());
    this.peerConnections.set(remoteUid, pc);

    this.localStream.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream);
    });

    pc.ontrack = (event) => {
      console.log(`🎵 Remote track received from ${remoteUid}`);
      this.remoteStreams.set(remoteUid, event.streams[0]);
      this.playRemoteAudio(remoteUid);
      this.stopSound('outgoing');
      this.playSound('connected');
      if (!this.callStartTime) this.startCallTimer();
      this.updateActiveGroupCallUI();
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        const signalId = `${currentUser.uid}_${remoteUid}`;
        try {
          await window.db.collection('groupCalls').doc(callId)
            .collection('signals').doc(signalId).set({
              from: currentUser.uid,
              to: remoteUid,
              iceCandidates: firebase.firestore.FieldValue.arrayUnion({
                candidate: event.candidate.toJSON(),
              }),
            }, { merge: true });
        } catch (e) {
          console.warn('Failed to send ICE to', remoteUid, e);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if ((state === 'disconnected' || state === 'failed' || state === 'closed') && !this.isEnding) {
        this.removePeer(remoteUid);
      }
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const signalId = `${currentUser.uid}_${remoteUid}`;
        await window.db.collection('groupCalls').doc(callId)
          .collection('signals').doc(signalId).set({
            from: currentUser.uid,
            to: remoteUid,
            offer: { type: offer.type, sdp: offer.sdp },
            iceCandidates: [],
          });

        this.subscribeToSignal(callId, signalId);
      } catch (err) {
        console.error('Create offer failed for', remoteUid, err);
      }
    }

    return pc;
  }

  async handleAnswer(callId, remoteUid, answer) {
    const pc = this.peerConnections.get(remoteUid);
    if (!pc) return;

    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`✅ Answer установлен от ${remoteUid}`);
      }
    } catch (e) {
      console.error(`❌ Ошибка установки answer от ${remoteUid}:`, e);
    }
  }

  async handleOffer(callId, fromUid, offer) {
    let pc = this.peerConnections.get(fromUid);
    if (!pc) {
      pc = await this.createPeerConnection(callId, fromUid, false);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const signalId = `${currentUser.uid}_${fromUid}`;
      await window.db.collection('groupCalls').doc(callId)
        .collection('signals').doc(signalId).set({
          from: currentUser.uid,
          to: fromUid,
          answer: { type: answer.type, sdp: answer.sdp },
          iceCandidates: [],
        });

      this.subscribeToSignal(callId, signalId);
    } catch (err) {
      console.error(`❌ Handle offer from ${fromUid} failed:`, err);
    }
  }

  async addIceCandidates(callId, fromUid, candidates) {
    const pc = this.peerConnections.get(fromUid);
    if (!pc) return;

    for (const ice of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(ice.candidate));
        console.log(`✅ ICE candidate добавлен от ${fromUid}`);
      } catch (e) {
        console.warn(`⚠️ Не удалось добавить ICE от ${fromUid}:`, e);
      }
    }
  }

  async removePeer(uid) {
    const pc = this.peerConnections.get(uid);
    if (pc) {
      pc.close();
      this.peerConnections.delete(uid);
    }
    this.remoteStreams.delete(uid);
    this.updateActiveGroupCallUI();
  }

  subscribeToCallDoc(callId) {
    this.signalListener?.();
    this.signalListener = window.db.collection('groupCalls').doc(callId)
      .onSnapshot(async (doc) => {
        if (!doc.exists || this.isEnding) return;
        const data = doc.data();
        if (data.status === 'ended' && !this.isEnding) {
          this.endGroupCall('ended');
        }
      }, err => console.error('❌ Group call doc listener:', err));
  }

  subscribeToParticipants(callId) {
    this.participantListener?.();
    this.participantListener = window.db.collection('groupCalls').doc(callId)
      .collection('signals')
      .onSnapshot(async (snap) => {
        for (const doc of snap.docs) {
          const data = doc.data();
          const signalKey = `${data.from}_${data.to}_${doc.id}`;

          if (this.processedSignals.has(signalKey)) continue;
          this.processedSignals.add(signalKey);

          if (data.to !== currentUser.uid) continue;

          if (data.answer && data.from !== currentUser.uid) {
            await this.handleAnswer(callId, data.from, data.answer);
          }

          if (data.offer && data.from !== currentUser.uid) {
            await this.handleOffer(callId, data.from, data.offer);
          }

          if (data.iceCandidates && Array.isArray(data.iceCandidates)) {
            await this.addIceCandidates(callId, data.from, data.iceCandidates);
          }
        }
      }, err => console.error('❌ Signals listener:', err));
  }

  async joinGroupCall(callId, callData) {
    if (this.currentCall) {
      await this.leaveGroupCall();
      return;
    }

    this.isEnding = false;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (err) {
      alert('Не удалось получить доступ к микрофону: ' + err.message);
      return;
    }

    this.currentCall = {
      callId,
      groupId: callData.groupId,
      groupName: callData.groupName,
      memberUids: Object.keys(callData.participants).filter(u => u !== currentUser.uid),
      isInitiator: false,
    };

    await window.db.collection('groupCalls').doc(callId).update({
      [`participants.${currentUser.uid}`]: {
        joinedAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'active',
      }
    });

    this.subscribeToCallDoc(callId);
    this.subscribeToParticipants(callId);

    this.hideIncomingGroupCallUI();
    this.stopSound('incoming');
    this.showActiveGroupCallUI(callData.groupName, Object.keys(callData.participants).length);
    this.startCallTimer();
  }

  async endGroupCall(reason = 'ended') {
    if (!this.currentCall || this.isEnding) return;
    this.isEnding = true;

    const { callId } = this.currentCall;
    clearTimeout(this.callTimeout);
    this.stopAllSounds();
    this.playSound('disconnected');
    this.stopCallTimer();

    const duration = this.callStartTime ? Math.floor((Date.now() - this.callStartTime) / 1000) : 0;

    try {
      await window.db.collection('groupCalls').doc(callId).update({
        status: reason,
        endedAt: firebase.firestore.FieldValue.serverTimestamp(),
        duration: duration,
      });

      const signalsSnap = await window.db.collection('groupCalls').doc(callId)
        .collection('signals').get();
      const batch = window.db.batch();
      signalsSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      await window.db.collection('groupCalls').doc(callId).delete();
    } catch (e) {
      console.warn('End group call error:', e);
    }

    this.cleanup();
    this.hideGroupCallUI();
  }

  async leaveGroupCall() {
    await this.endGroupCall('left');
  }

  cleanup() {
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.remoteStreams.clear();
    this.peerConnections.forEach(pc => pc.close());
    this.peerConnections.clear();
    this.signalListener?.();
    this.participantListener?.();
    this.signalListener = null;
    this.participantListener = null;
    this.currentCall = null;
    clearTimeout(this.callTimeout);
    this.stopCallTimer();
    this.processedSignals.clear();
  }

  playRemoteAudio(uid) {
    const stream = this.remoteStreams.get(uid);
    if (!stream) return;
    const existing = document.getElementById(`group-call-audio-${uid}`);
    if (existing) existing.remove();
    const audioEl = document.createElement('audio');
    audioEl.id = `group-call-audio-${uid}`;
    audioEl.srcObject = stream;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    document.body.appendChild(audioEl);
    audioEl.play().catch(e => console.warn('Remote audio play:', e));
  }

  startCallTimer() {
    this.callStartTime = Date.now();
    this.callTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - this.callStartTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const timerEl = document.getElementById('group-call-timer');
      if (timerEl) timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
  }

  stopCallTimer() {
    clearInterval(this.callTimerInterval);
    this.callTimerInterval = null;
  }

  // ── UI ───────────────────────────────────────────────────

  showOutgoingGroupCallUI(groupName, memberCount) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;
    overlay.innerHTML = `
      <div class="call-modal call-outgoing">
        <div class="call-avatar-big">👥</div>
        <div class="call-name">${esc(groupName)}</div>
        <div class="call-status">Групповой звонок (${memberCount} участников)...</div>
        <div class="call-actions">
          <button class="call-action-btn call-end-btn" id="group-call-end-btn" title="Завершить">📞</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');
    document.getElementById('group-call-end-btn').addEventListener('click', () => this.endGroupCall('canceled'));
  }

  showActiveGroupCallUI(groupName, participantCount) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;

    const participantsHtml = Array.from(this.remoteStreams.keys())
      .map(uid => `<div class="group-call-participant">🔊 ${esc(userCache[uid]?.name || 'Участник')}</div>`)
      .join('');

    overlay.innerHTML = `
      <div class="call-modal call-active">
        <div class="call-avatar-big">👥</div>
        <div class="call-name">${esc(groupName)}</div>
        <div class="call-timer" id="group-call-timer">0:00</div>
        <div class="group-call-participants">${participantsHtml}</div>
        <div class="call-actions">
          <button class="call-action-btn" id="group-call-mute-btn" title="Выключить микрофон">🎙️</button>
          <button class="call-action-btn call-end-btn" id="group-call-end-btn" title="Завершить">📞</button>
        </div>
      </div>
    `;
    overlay.classList.add('active');

    document.getElementById('group-call-mute-btn').addEventListener('click', () => this.toggleMute());
    document.getElementById('group-call-end-btn').addEventListener('click', () => this.endGroupCall());

    if (this.callStartTime) this.startCallTimer();
  }

  updateActiveGroupCallUI() {
    const overlay = document.getElementById('call-overlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    if (this.currentCall) {
      this.showActiveGroupCallUI(this.currentCall.groupName, this.peerConnections.size + 1);
    }
  }

  toggleMute() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    const muteBtn = document.getElementById('group-call-mute-btn');
    if (muteBtn) {
      muteBtn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
      muteBtn.title = audioTrack.enabled ? 'Выключить микрофон' : 'Включить микрофон';
    }
  }

  hideGroupCallUI() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  showIncomingGroupCallUI(callId, callData) {
    this.loadSounds();
    let modal = document.getElementById('group-call-incoming-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'group-call-incoming-modal';
      modal.className = 'call-incoming-overlay';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="call-modal call-incoming">
        <div class="call-avatar-big">👥</div>
        <div class="call-name">${esc(callData.groupName)}</div>
        <div class="call-status">Групповой звонок...</div>
        <div class="call-actions">
          <button class="call-action-btn call-reject-btn" id="group-call-reject-btn" title="Отклонить">❌</button>
          <button class="call-action-btn call-answer-btn" id="group-call-answer-btn" title="Принять">✅</button>
        </div>
      </div>
    `;
    modal.classList.add('active');

    document.getElementById('group-call-answer-btn').addEventListener('click', async () => {
      await this.joinGroupCall(callId, callData);
    });
    document.getElementById('group-call-reject-btn').addEventListener('click', () => {
      this.stopSound('incoming');
      this.hideIncomingGroupCallUI();
    });

    this.playSound('incoming');
  }

  hideIncomingGroupCallUI() {
    const modal = document.getElementById('group-call-incoming-modal');
    if (modal) modal.classList.remove('active');
  }

  subscribeIncomingGroupCalls(myUid) {
    window.db.collection('groupCalls')
      .where('status', '==', 'ringing')
      .where('memberUids', 'array-contains', myUid)
      .onSnapshot(async (snap) => {
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data._shown) continue;
          if (data.initiatorUid === myUid) continue;

          try {
            await doc.ref.update({ _shown: true });
          } catch (e) {}

          this.showIncomingGroupCallUI(doc.id, data);
        }
      }, err => console.error('Incoming group calls error:', err));
  }
}

const groupCallManager = new GroupCallManager();

// ─── GROUP UI RENDERING ────────────────────────────────────

function renderGroupsUI(myUid) {
  const root = document.getElementById('groups-root');
  if (!root) return;

  root.innerHTML = `
    <div class="groups-layout">
      <div class="groups-sidebar">
        <div class="groups-sidebar-header">
          <h3>👥 Группы</h3>
          <button class="groups-new-btn" id="new-group-btn">+ Создать</button>
        </div>
        <div class="groups-list" id="groups-list">
          <div class="groups-empty">Загрузка...</div>
        </div>
      </div>
      <div class="group-chat-area" id="group-chat-area">
        <div class="group-chat-placeholder">
          <div>
            <div class="group-chat-placeholder-icon">👥</div>
            <div>Выберите группу или создайте новую</div>
          </div>
        </div>
      </div>
    </div>
  `;

  initGroupsList(myUid);
  initNewGroupModal(); // ✅ Теперь создаёт модальное окно динамически
}

function initGroupsList(myUid) {
  const list = document.getElementById('groups-list');
  if (!list) return;

  groupManager.subscribeGroups(myUid, groups => {
    list.innerHTML = '';
    if (groups.length === 0) {
      list.innerHTML = '<div class="groups-empty">Нет групп.<br>Создайте первую!</div>';
      return;
    }
    groups.forEach(group => {
      list.appendChild(renderGroupItem(group, myUid));
    });
  });
}

function renderGroupItem(group, myUid) {
  const preview = group.lastMessage
    ? '🔐 Зашифрованное сообщение'
    : 'Группа создана';

  const li = document.createElement('div');
  li.className = 'group-item';
  li.dataset.groupId = group.id;
  if (group.id === groupManager.activeGroupId) li.classList.add('active');

  li.innerHTML = `
    <div class="group-avatar">👥</div>
    <div class="group-info">
      <div class="group-name">${esc(group.name)}</div>
      <div class="group-preview">${esc(preview)}</div>
      <div class="group-members">${(group.members || []).length} участников</div>
    </div>
  `;

  li.addEventListener('click', () => openGroupChat(group.id, group.name, group.members));
  return li;
}

// ─── OPEN GROUP CHAT ───────────────────────────────────────

async function openGroupChat(groupId, groupName, members) {
  groupManager.activeGroupId = groupId;

  document.querySelectorAll('.group-item').forEach(el => {
    el.classList.toggle('active', el.dataset.groupId === groupId);
  });

  const chatArea = document.getElementById('group-chat-area');
  if (!chatArea) return;

  chatArea.innerHTML = `
    <div class="group-chat-header">
      <div class="group-chat-header-avatar">👥</div>
      <div class="group-chat-header-info" id="group-header-clickable" style="flex:1;cursor:pointer;">
        <div class="group-chat-header-name">${esc(groupName)}</div>
        <div class="group-chat-header-members">${(members || []).length} участников</div>
      </div>
      <button class="group-chat-info-btn" id="group-chat-info-btn" title="Информация о группе" style="background:none;border:none;font-size:1.2rem;cursor:pointer;padding:4px 8px;opacity:.7;">ℹ️</button>
      <button class="group-chat-call-btn" id="group-chat-call-btn" title="Групповой звонок">📞</button>
    </div>
    <div style="display:flex;flex:1;overflow:hidden;">
      <div class="group-chat-messages" id="group-chat-messages" style="flex:1;overflow-y:auto;"></div>
      <div id="group-profile-panel" style="display:none;width:280px;min-width:280px;border-left:1px solid var(--border,#333);overflow-y:auto;background:var(--bg-secondary,#1a1a2e);padding:16px;box-sizing:border-box;"></div>
    </div>
    <div class="group-chat-input-area">
      <textarea class="group-chat-input" id="group-chat-input" rows="1" placeholder="Написать в группу..."></textarea>
      <button class="group-chat-send-btn" id="group-chat-send-btn">↑</button>
    </div>
  `;

  // ── Кнопка инфо / клик по шапке ──
  const toggleProfile = () => showGroupProfile(groupId);
  document.getElementById('group-chat-info-btn').addEventListener('click', toggleProfile);
  document.getElementById('group-header-clickable').addEventListener('click', toggleProfile);

  // ── Кнопка звонка ──
  document.getElementById('group-chat-call-btn').addEventListener('click', () => {
    groupCallManager.startGroupCall(groupId, groupName, members);
  });

  // ── Отправка ──
  const inputEl = document.getElementById('group-chat-input');
  const sendBtn = document.getElementById('group-chat-send-btn');

  const send = async () => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    inputEl.style.height = 'auto';
    try {
      await groupManager.sendMessage(groupId, text);
    } catch (e) {
      alert(e.message);
    }
  };

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // ── Подписка на сообщения ──
  const msgContainer = document.getElementById('group-chat-messages');
  groupManager.subscribeMessages(groupId, currentUser.uid, messages => {
    renderGroupMessages(messages, msgContainer);
  });
}

// ─── GROUP PROFILE PANEL ───────────────────────────────────

async function showGroupProfile(groupId) {
  const panel = document.getElementById('group-profile-panel');
  if (!panel) return;

  // Toggle
  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = '<div style="color:var(--muted,#888);padding:8px 0;">Загрузка...</div>';

  // Всегда свежие данные
  delete groupManager.groupCache[groupId];
  const group = await groupManager.getGroup(groupId);
  if (!group) {
    panel.innerHTML = '<div style="color:var(--muted,#888);">Группа не найдена</div>';
    return;
  }

  const isCreator = group.createdBy === currentUser.uid;
  const members = group.members || [];

  const membersHtml = members.map(uid => {
    const name = group.memberNames?.[uid] || 'Участник';
    const avatar = group.memberAvatars?.[uid] || null;
    const isMe = uid === currentUser.uid;
    const isOwner = uid === group.createdBy;

    return `
      <div class="group-profile-member" data-uid="${uid}" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#2a2a3e);">
        <div style="flex-shrink:0;">${avatarHtml(avatar, name, 36)}</div>
        <div style="flex:1;min-width:0;">
          <div style="color:var(--text,#fff);font-size:.88rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(name)}${isMe ? ' <span style="color:var(--muted,#888);font-weight:400;">(вы)</span>' : ''}
          </div>
          ${isOwner ? '<div style="color:var(--accent,#7c3aed);font-size:.75rem;">Создатель</div>' : ''}
        </div>
        ${(isCreator && !isMe) ? `<button class="group-profile-remove-btn" data-uid="${uid}" title="Удалить из группы" style="background:none;border:none;color:var(--danger,#ef4444);cursor:pointer;font-size:1rem;padding:2px 6px;opacity:.7;flex-shrink:0;">✕</button>` : ''}
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:3rem;">👥</div>
      <div style="color:var(--text,#fff);font-weight:600;font-size:1rem;margin-top:6px;">${esc(group.name)}</div>
      <div style="color:var(--muted,#888);font-size:.8rem;margin-top:2px;">${members.length} участников</div>
    </div>

    <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#888);margin-bottom:8px;">Участники</div>
    <div id="group-members-list">${membersHtml}</div>

    <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
      <button id="group-add-member-btn" style="padding:8px 12px;border-radius:8px;border:1px solid var(--accent,#7c3aed);background:none;color:var(--accent,#7c3aed);cursor:pointer;font-size:.88rem;width:100%;">
        + Добавить участника
      </button>
      ${isCreator
        ? `<button id="group-delete-btn" style="padding:8px 12px;border-radius:8px;border:1px solid var(--danger,#ef4444);background:none;color:var(--danger,#ef4444);cursor:pointer;font-size:.88rem;width:100%;">
             🗑️ Удалить группу
           </button>`
        : `<button id="group-leave-btn" style="padding:8px 12px;border-radius:8px;border:1px solid var(--danger,#ef4444);background:none;color:var(--danger,#ef4444);cursor:pointer;font-size:.88rem;width:100%;">
             🚪 Покинуть группу
           </button>`
      }
    </div>
  `;

  // ── Добавить участника ──
  panel.querySelector('#group-add-member-btn')?.addEventListener('click', () => {
    showAddMemberModal(groupId, group);
  });

  // ── Удалить группу ──
  panel.querySelector('#group-delete-btn')?.addEventListener('click', async () => {
    if (!confirm(`Удалить группу «${group.name}»? Это действие нельзя отменить.`)) return;
    try {
      await groupManager.deleteGroup(groupId);
      panel.style.display = 'none';
      const chatArea = document.getElementById('group-chat-area');
      if (chatArea) {
        chatArea.innerHTML = `
          <div class="group-chat-placeholder">
            <div>
              <div class="group-chat-placeholder-icon">👥</div>
              <div>Выберите группу или создайте новую</div>
            </div>
          </div>
        `;
      }
    } catch (e) {
      alert('Не удалось удалить группу: ' + e.message);
    }
  });

  // ── Покинуть группу ──
  panel.querySelector('#group-leave-btn')?.addEventListener('click', async () => {
    if (!confirm(`Покинуть группу «${group.name}»?`)) return;
    try {
      await groupManager.removeMember(groupId, currentUser.uid);
      panel.style.display = 'none';
      const chatArea = document.getElementById('group-chat-area');
      if (chatArea) {
        chatArea.innerHTML = `
          <div class="group-chat-placeholder">
            <div>
              <div class="group-chat-placeholder-icon">👥</div>
              <div>Выберите группу или создайте новую</div>
            </div>
          </div>
        `;
      }
    } catch (e) {
      alert('Не удалось покинуть группу: ' + e.message);
    }
  });

  // ── Удалить участника ──
  panel.querySelectorAll('.group-profile-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      const name = group.memberNames?.[uid] || 'участника';
      if (!confirm(`Удалить ${name} из группы?`)) return;
      try {
        await groupManager.removeMember(groupId, uid);
        btn.closest('[data-uid]').remove();
      } catch (e) {
        alert('Не удалось удалить участника: ' + e.message);
      }
    });
  });
}

// ─── ADD MEMBER MODAL ──────────────────────────────────────

function showAddMemberModal(groupId, group) {
  let modal = document.getElementById('add-member-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'add-member-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div id="add-member-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);"></div>
    <div style="position:relative;z-index:1;background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#333);border-radius:14px;padding:24px;width:360px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;color:var(--text,#fff);font-size:1rem;">+ Добавить участника</h3>
        <button id="add-member-close" style="background:none;border:none;color:var(--muted,#888);font-size:1.4rem;cursor:pointer;line-height:1;">×</button>
      </div>
      <input type="text" id="add-member-search" placeholder="Поиск по имени..." autocomplete="off"
        style="padding:10px 14px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0f0f1a);color:var(--text,#fff);font-size:.9rem;outline:none;">
      <div id="add-member-results" style="overflow-y:auto;max-height:300px;display:flex;flex-direction:column;gap:4px;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#add-member-close').addEventListener('click', close);
  modal.querySelector('#add-member-backdrop').addEventListener('click', close);

  const searchInput = modal.querySelector('#add-member-search');
  const results = modal.querySelector('#add-member-results');

  searchInput.focus();

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
      results.innerHTML = '<div style="color:var(--muted,#888);padding:8px;font-size:.85rem;">Поиск...</div>';
      try {
        const snap = await window.db.collection('users')
          .where('name', '>=', q)
          .where('name', '<=', q + '\uf8ff')
          .limit(10)
          .get();

        results.innerHTML = '';
        let found = 0;

        snap.forEach(doc => {
          if (doc.id === currentUser.uid) return;
          if ((group.members || []).includes(doc.id)) return; // Уже в группе

          found++;
          const data = doc.data();
          const el = document.createElement('div');
          el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;';
          el.innerHTML = `
            <div style="flex-shrink:0;">${avatarHtml(data.avatar, data.name, 34)}</div>
            <div style="flex:1;color:var(--text,#fff);font-size:.88rem;font-weight:500;">${esc(data.name)}</div>
            <button data-uid="${doc.id}" style="padding:5px 12px;border-radius:6px;border:1px solid var(--accent,#7c3aed);background:none;color:var(--accent,#7c3aed);cursor:pointer;font-size:.82rem;flex-shrink:0;">
              + Добавить
            </button>
          `;

          el.querySelector('button').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = '...';
            try {
              await groupManager.addMember(groupId, doc.id);
              btn.textContent = '✓';
              btn.style.color = 'var(--success,#22c55e)';
              btn.style.borderColor = 'var(--success,#22c55e)';
              // Обновляем панель профиля если открыта
              const panel = document.getElementById('group-profile-panel');
              if (panel && panel.style.display !== 'none') {
                showGroupProfile(groupId);
              }
            } catch (err) {
              btn.disabled = false;
              btn.textContent = '+ Добавить';
              alert('Не удалось добавить: ' + err.message);
            }
          });

          results.appendChild(el);
        });

        if (found === 0) {
          results.innerHTML = '<div style="color:var(--muted,#888);padding:8px;font-size:.85rem;">Пользователи не найдены или уже в группе</div>';
        }
      } catch (err) {
        console.error('Search error:', err);
        results.innerHTML = '<div style="color:var(--danger,#ef4444);padding:8px;font-size:.85rem;">Ошибка поиска</div>';
      }
    }, 350);
  });
}

// ─── RENDER MESSAGES ───────────────────────────────────────

function renderGroupMessages(messages, container) {
  const fragment = document.createDocumentFragment();
  let lastDate = null;

  messages.forEach(msg => {
    const dateStr = formatMsgDate(msg.createdAt);
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const div = document.createElement('div');
      div.className = 'msg-date-divider';
      div.textContent = dateStr;
      fragment.appendChild(div);
    }

    const isOwn = msg.senderUid === currentUser.uid;
    // ✅ Берём актуальные имя и аватар из userCache (заполненного до рендера)
    const cachedSender  = userCache[msg.senderUid] || {};
    const senderName    = cachedSender.name   || msg.senderName || 'Участник';
    const senderAvatar  = cachedSender.avatar || null;

    const msgEl = document.createElement('div');
    msgEl.className = `msg group-msg ${isOwn ? 'own' : ''}`;

    const hasImage = !!msg.image;
    const hasText = !!String(msg.text || '').trim();
    const imageHtml = hasImage ? `<img class="msg-image" src="${esc(msg.image)}" alt="Изображение" loading="lazy" style="max-width:260px;border-radius:8px;display:block;">` : '';
    const textHtml = hasText ? `<div class="msg-text">${esc(msg.text)}</div>` : '';

    msgEl.innerHTML = `
      <div class="msg-avatar">${avatarHtml(senderAvatar, senderName, 28)}</div>
      <div class="msg-content">
        ${!isOwn ? `<div class="msg-sender-name" style="font-size:.75rem;color:var(--muted,#888);margin-bottom:2px;">${esc(senderName)}</div>` : ''}
        <div class="msg-bubble">
          ${imageHtml}${textHtml}
        </div>
        <div class="msg-time">${formatMsgTime(msg.createdAt)}</div>
      </div>
    `;

    fragment.appendChild(msgEl);
  });

  container.innerHTML = '';
  container.appendChild(fragment);
  scrollChatToBottom(container);
}

// ─── NEW GROUP MODAL (динамический) ────────────────────────

function initNewGroupModal() {
  const openBtn = document.getElementById('new-group-btn');
  if (!openBtn) return;

  // ✅ FIX: Создаём модальное окно полностью динамически —
  // больше не зависим от статического HTML в файле страницы.
  let modal = document.getElementById('new-group-modal');
  if (modal) modal.remove(); // Удаляем старый экземпляр при повторной инициализации

  modal = document.createElement('div');
  modal.id = 'new-group-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div id="new-group-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);"></div>
    <div style="position:relative;z-index:1;background:var(--bg-secondary,#1a1a2e);border:1px solid var(--border,#333);border-radius:14px;padding:24px;width:400px;max-width:90vw;max-height:85vh;display:flex;flex-direction:column;gap:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h3 style="margin:0;color:var(--text,#fff);font-size:1rem;">Создать группу</h3>
        <button id="new-group-close" style="background:none;border:none;color:var(--muted,#888);font-size:1.4rem;cursor:pointer;line-height:1;">×</button>
      </div>

      <input type="text" id="new-group-name" placeholder="Название группы" autocomplete="off"
        style="padding:10px 14px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0f0f1a);color:var(--text,#fff);font-size:.9rem;outline:none;">

      <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#888);">Участники</div>

      <div id="new-group-selected" style="display:flex;flex-wrap:wrap;gap:6px;min-height:0;"></div>

      <input type="text" id="new-group-search" placeholder="Поиск пользователей..." autocomplete="off"
        style="padding:10px 14px;border-radius:8px;border:1px solid var(--border,#333);background:var(--bg,#0f0f1a);color:var(--text,#fff);font-size:.9rem;outline:none;">

      <div id="new-group-results" style="overflow-y:auto;max-height:220px;display:flex;flex-direction:column;gap:4px;"></div>

      <button id="new-group-create" style="padding:10px;border-radius:8px;border:none;background:var(--accent,#7c3aed);color:#fff;cursor:pointer;font-size:.9rem;font-weight:600;margin-top:4px;">
        Создать группу
      </button>
    </div>
  `;
  document.body.appendChild(modal);

  const nameInput = modal.querySelector('#new-group-name');
  const searchInput = modal.querySelector('#new-group-search');
  const results = modal.querySelector('#new-group-results');
  const selectedDisplay = modal.querySelector('#new-group-selected');
  const createBtn = modal.querySelector('#new-group-create');

  // ✅ Map вместо Set — храним uid → name для отображения
  let selectedMembers = new Map();

  const open = () => {
    modal.style.display = 'flex';
    nameInput.focus();
  };

  const close = () => {
    modal.style.display = 'none';
    nameInput.value = '';
    searchInput.value = '';
    results.innerHTML = '';
    selectedMembers.clear();
    renderSelected();
  };

  openBtn.addEventListener('click', open);
  modal.querySelector('#new-group-close').addEventListener('click', close);
  modal.querySelector('#new-group-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.style.display !== 'none') close();
  });

  function renderSelected() {
    selectedDisplay.innerHTML = '';
    selectedMembers.forEach((name, uid) => {
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;background:var(--accent-bg,rgba(124,58,237,.15));border:1px solid var(--accent,#7c3aed);border-radius:20px;padding:3px 10px 3px 8px;font-size:.8rem;color:var(--accent,#7c3aed);';
      chip.innerHTML = `<span>${esc(name)}</span><button data-uid="${uid}" style="background:none;border:none;color:var(--accent,#7c3aed);cursor:pointer;font-size:.9rem;padding:0;line-height:1;margin-left:2px;">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        selectedMembers.delete(uid);
        renderSelected();
        // Снимаем галочку в результатах поиска если видны
        results.querySelectorAll(`[data-uid="${uid}"]`).forEach(el => {
          el.classList.remove('selected');
          const btn = el.querySelector('.ng-select-btn');
          if (btn) { btn.textContent = '+'; btn.style.color = 'var(--accent,#7c3aed)'; btn.style.borderColor = 'var(--accent,#7c3aed)'; }
        });
      });
      selectedDisplay.appendChild(chip);
    });
  }

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
      results.innerHTML = '<div style="color:var(--muted,#888);padding:8px;font-size:.85rem;">Поиск...</div>';
      try {
        const snap = await window.db.collection('users')
          .where('name', '>=', q)
          .where('name', '<=', q + '\uf8ff')
          .limit(10)
          .get();

        results.innerHTML = '';

        snap.forEach(doc => {
          if (doc.id === currentUser.uid) return;
          const data = doc.data();
          const isSelected = selectedMembers.has(doc.id);

          const el = document.createElement('div');
          el.dataset.uid = doc.id;
          el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background .15s;';
          el.innerHTML = `
            <div style="flex-shrink:0;">${avatarHtml(data.avatar, data.name, 34)}</div>
            <div style="flex:1;color:var(--text,#fff);font-size:.88rem;font-weight:500;">${esc(data.name)}</div>
            <button class="ng-select-btn" style="padding:5px 12px;border-radius:6px;border:1px solid ${isSelected ? 'var(--success,#22c55e)' : 'var(--accent,#7c3aed)'};background:none;color:${isSelected ? 'var(--success,#22c55e)' : 'var(--accent,#7c3aed)'};cursor:pointer;font-size:.82rem;flex-shrink:0;">
              ${isSelected ? '✓' : '+'}
            </button>
          `;

          el.addEventListener('click', () => {
            const btn = el.querySelector('.ng-select-btn');
            if (selectedMembers.has(doc.id)) {
              selectedMembers.delete(doc.id);
              btn.textContent = '+';
              btn.style.color = 'var(--accent,#7c3aed)';
              btn.style.borderColor = 'var(--accent,#7c3aed)';
            } else {
              selectedMembers.set(doc.id, data.name);
              btn.textContent = '✓';
              btn.style.color = 'var(--success,#22c55e)';
              btn.style.borderColor = 'var(--success,#22c55e)';
            }
            renderSelected();
          });

          results.appendChild(el);
        });

        if (results.innerHTML === '') {
          results.innerHTML = '<div style="color:var(--muted,#888);padding:8px;font-size:.85rem;">Пользователи не найдены</div>';
        }
      } catch (err) {
        console.error('Search error:', err);
        results.innerHTML = '<div style="color:var(--danger,#ef4444);padding:8px;font-size:.85rem;">Ошибка поиска</div>';
      }
    }, 350);
  });

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Введите название группы'); return; }
    if (selectedMembers.size === 0) { alert('Выберите хотя бы одного участника'); return; }

    createBtn.disabled = true;
    createBtn.textContent = 'Создание...';

    try {
      const groupId = await groupManager.createGroup(name, Array.from(selectedMembers.keys()));
      close();
      const group = await groupManager.getGroup(groupId);
      if (group) openGroupChat(groupId, name, group.members);
    } catch (e) {
      alert('Не удалось создать группу: ' + e.message);
      createBtn.disabled = false;
      createBtn.textContent = 'Создать группу';
    }
  });
}

// ─── GROUPS INIT ───────────────────────────────────────────

function initGroups() {
  waitForFirebase(() => {
    window.auth.onAuthStateChanged(user => {
      if (!user) return;
      renderGroupsUI(user.uid);
      groupCallManager.subscribeIncomingGroupCalls(user.uid);
    });
  });
}

if (document.getElementById('groups-root')) {
  initGroups();
}