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
    if (memberUid === currentUser.uid) continue;
    const pubKey = await getPublicKey(memberUid);
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

    // Загружаем данные всех участников
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
  }

  async removeMember(groupId, uid) {
    const groupRef = window.db.collection('groups').doc(groupId);
    await groupRef.update({
      members: firebase.firestore.FieldValue.arrayRemove(uid),
      [`memberNames.${uid}`]: firebase.firestore.FieldValue.delete(),
      [`memberAvatars.${uid}`]: firebase.firestore.FieldValue.delete(),
    });
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
    this.peerConnections = new Map(); // Map<uid, RTCPeerConnection>
    this.localStream = null;
    this.remoteStreams = new Map(); // Map<uid, MediaStream>
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

    // Создаём звонок в БД
    const group = await this.getGroup(groupId);
    const memberUids = group.members || [];
    
    await window.db.collection('groupCalls').doc(callId).set({
      groupId,
      groupName,
      memberUids, // ← ES6 shorthand: memberUids: memberUids
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

    // Подписываемся на изменения звонка
    this.subscribeToCallDoc(callId);
    this.subscribeToParticipants(callId);

    // Создаём соединения с каждым участником
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

    // Добавляем локальный трек
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

        // Обработка завершения звонка
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

          // Обрабатываем только сигналы для нас
          if (data.to !== currentUser.uid) continue;

          // Answer (для инициатора)
          if (data.answer && data.from !== currentUser.uid) {
            await this.handleAnswer(callId, data.from, data.answer);
          }

          // Offer (для присоединившегося)
          if (data.offer && data.from !== currentUser.uid) {
            await this.handleOffer(callId, data.from, data.offer);
          }

          // ICE candidates
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

    // Обновляем статус участника
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

      // Удаляем все сигналы
      const signalsSnap = await window.db.collection('groupCalls').doc(callId)
        .collection('signals').get();
      const batch = window.db.batch();
      signalsSnap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      // Удаляем сам звонок
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
    // Просто перерендериваем
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
      .where('memberUids', 'array-contains', myUid) // ← ДОБАВЛЕНО
      .onSnapshot(async (snap) => {
        for (const doc of snap.docs) {
          const data = doc.data();
          if (data._shown) continue;
          if (data.initiatorUid === myUid) continue; // Не показываем свои звонки
          
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
  initNewGroupModal();
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
  const otherMembers = group.members.filter(u => u !== myUid);
  const memberNames = otherMembers.map(u => group.memberNames?.[u] || 'Участник');
  const preview = group.lastMessage
    ? (group._encrypted ? '🔐 Зашифрованное сообщение' : group.lastMessage.slice(0, 35) + '…')
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
      <div class="group-members">${memberNames.length} участников</div>
    </div>
  `;

  li.addEventListener('click', () => openGroupChat(group.id, group.name, group.members));
  return li;
}

async function openGroupChat(groupId, groupName, members) {
  groupManager.activeGroupId = groupId;

  // Подсветка в сайдбаре
  document.querySelectorAll('.group-item').forEach(el => {
    el.classList.toggle('active', el.dataset.groupId === groupId);
  });

  const chatArea = document.getElementById('group-chat-area');
  if (!chatArea) return;

  chatArea.innerHTML = `
    <div class="group-chat-header">
      <div class="group-chat-header-avatar">👥</div>
      <div>
        <div class="group-chat-header-name">${esc(groupName)}</div>
        <div class="group-chat-header-members">${members.length} участников</div>
      </div>
      <button class="group-chat-call-btn" id="group-chat-call-btn" title="Групповой звонок">📞</button>
    </div>
    <div class="group-chat-messages" id="group-chat-messages"></div>
    <div class="group-chat-input-area">
      <textarea class="group-chat-input" id="group-chat-input" rows="1" placeholder="Написать в группу..."></textarea>
      <button class="group-chat-send-btn" id="group-chat-send-btn">↑</button>
    </div>
  `;

  // Кнопка звонка
  document.getElementById('group-chat-call-btn').addEventListener('click', () => {
    groupCallManager.startGroupCall(groupId, groupName, members);
  });

  // Отправка
  const inputEl = document.getElementById('group-chat-input');
  const sendBtn = document.getElementById('group-chat-send-btn');

  const send = async () => {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
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

  // Подписка на сообщения
  const msgContainer = document.getElementById('group-chat-messages');
  groupManager.subscribeMessages(groupId, currentUser.uid, messages => {
    renderGroupMessages(messages, msgContainer);
  });
}

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
    const senderName = msg.senderName || userCache[msg.senderUid]?.name || 'Участник';

    const msgEl = document.createElement('div');
    msgEl.className = `msg group-msg ${isOwn ? 'own' : ''}`;

    msgEl.innerHTML = `
      <div class="msg-avatar">${avatarHtml(null, senderName, 28)}</div>
      <div class="msg-content">
        <div class="msg-sender-name">${esc(senderName)}</div>
        <div class="msg-bubble">
          <div class="msg-text">${esc(msg.text)}</div>
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

function initNewGroupModal() {
  const modal = document.getElementById('new-group-modal');
  if (!modal) return;

  const openBtn = document.getElementById('new-group-btn');
  const closeBtn = document.getElementById('new-group-close');
  const backdrop = document.getElementById('new-group-backdrop');
  const createBtn = document.getElementById('new-group-create');
  const nameInput = document.getElementById('new-group-name');
  const searchInput = document.getElementById('new-group-search');
  const results = document.getElementById('new-group-results');

  let selectedMembers = new Set();

  const open = () => { modal.classList.add('open'); nameInput.focus(); };
  const close = () => {
    modal.classList.remove('open');
    nameInput.value = '';
    searchInput.value = '';
    results.innerHTML = '';
    selectedMembers.clear();
  };

  openBtn?.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  createBtn?.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { alert('Введите название группы'); return; }
    if (selectedMembers.size === 0) { alert('Выберите хотя бы одного участника'); return; }

    try {
      const groupId = await groupManager.createGroup(name, Array.from(selectedMembers));
      close();
      // Открываем созданную группу
      const group = await groupManager.getGroup(groupId);
      openGroupChat(groupId, name, group.members);
    } catch (e) {
      alert('Не удалось создать группу: ' + e.message);
    }
  });

  let searchTimeout;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }

    searchTimeout = setTimeout(async () => {
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
          el.className = `new-group-user ${isSelected ? 'selected' : ''}`;
          el.innerHTML = `
            <div class="new-group-user-avatar">${avatarHtml(data.avatar, data.name, 32)}</div>
            <div>
              <div style="color:#fff;font-size:.88rem;font-weight:500;">${esc(data.name)}</div>
            </div>
            <div style="margin-left:auto;color:var(--accent);font-size:1.2rem;${isSelected ? '' : 'opacity:0.3;'}">${isSelected ? '✓' : '+'}</div>
          `;

          el.addEventListener('click', () => {
            if (selectedMembers.has(doc.id)) {
              selectedMembers.delete(doc.id);
              el.classList.remove('selected');
              el.querySelector('div[style*="margin-left"]').textContent = '+';
              el.querySelector('div[style*="margin-left"]').style.opacity = '0.3';
            } else {
              selectedMembers.add(doc.id);
              el.classList.add('selected');
              el.querySelector('div[style*="margin-left"]').textContent = '✓';
              el.querySelector('div[style*="margin-left"]').style.opacity = '1';
            }
          });

          results.appendChild(el);
        });
      } catch (err) {
        console.error('Search error:', err);
      }
    }, 350);
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

// Автоинициализация если есть корневой элемент
if (document.getElementById('groups-root')) {
  initGroups();
}