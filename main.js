// Constants
const CONFIG = {
        STUN_SERVER: 'stun:stun.l.google.com:19302',
        DTMF_DURATION: 100, // milliseconds
        DTMF_GAP: 50       // gap between tones in milliseconds
    };

    // UI Elements
    const UI = {
        localVideo: document.getElementById('local-video'),
        remoteVideo: document.getElementById('remote-video'),
        log: document.getElementById('log'),
        statusIndicator: document.querySelector('.status-indicator'),
        username: document.getElementById('username'),
        activeCall: document.getElementById('active-call'),
        extension: document.getElementById('extension'),
        forms: {
            sip: document.getElementById('create-sip-form'),
            call: document.getElementById('call-form')
        },
        buttons: {
            answer: document.getElementById('answer-btn'),
            call: document.getElementById('call-btn'),
            hangup: document.getElementById('hangup-btn'),
            transfer: document.getElementById('transfer-btn'),
            mute: document.getElementById('mute-btn'),
            unmute: document.getElementById('unmute-btn'),
            hold: document.getElementById('hold-btn'),
            unhold: document.getElementById('unhold-btn'),
            unregister: document.getElementById('unregister-btn')
        }
    };

    // Call State Management
    class CallManager {
        constructor() {
            this.userAgent = null;
            this.registerer = null;
            this.session = null;
            this.registered = false;
            this.credentials = {};
        }

        // Logging utility
        log(message) {
            console.log(message);
            UI.log.innerHTML += `${new Date().toISOString()} - ${message}<br>`;
            UI.log.parentElement.scrollTop = UI.log.parentElement.scrollHeight;
        }

        // SIP Configuration and Registration
        // async configureSIP(formData) {
        //     this.credentials = {
        //         username: formData.sipUsername.value,
        //         domain: "20.87.96.52",
        //         password: "Nenacall@Mobile.2025",
        //         wssServer: "wss://20.87.96.52:7443"
        //     };

        //     UI.username.textContent = this.credentials.username;
        //     await this.setupUserAgent();
        // }
        async configureSIP(formData) {
            this.credentials = {
                username: formData.sipUsername.value,
                domain: formData.sipDomain.value,
                password: 1234,
                wssServer: "wss://"+formData.sipDomain.value+formData.sipPort.value
            };

            UI.username.textContent = this.credentials.username;
            await this.setupUserAgent();
        }

        async setupUserAgent() {
            const uri = SIP.UserAgent.makeURI(`sip:${this.credentials.username}@${this.credentials.domain}`);
            if (!uri) throw new Error('Invalid SIP URI');

            this.log(`Setting up SIP UA for ${this.credentials.username}@${this.credentials.domain}`);

            const uaOptions = {
                uri,
                authorizationUsername: this.credentials.username,
                authorizationPassword: this.credentials.password,
                transportOptions: { server: this.credentials.wssServer },
                sessionDescriptionHandlerFactoryOptions: {
                    peerConnectionConfiguration: {
                        iceServers: [{ urls: CONFIG.STUN_SERVER }]
                    },
                    constraints: { audio: true, video: false }
                },
                delegate: { onInvite: invitation => this.handleIncomingCall(invitation) }
            };

            this.userAgent = new SIP.UserAgent(uaOptions);
            this.registerer = new SIP.Registerer(this.userAgent);

            this.setupTransportListeners();
            this.registerer.stateChange.addListener(state => this.handleRegistrationState(state));

            await this.userAgent.start();
            this.log("UserAgent started, connecting...");
            await this.register();
        }

        setupTransportListeners() {
            this.userAgent.transport.onConnect = () => this.log("Connected to SIP server");
            this.userAgent.transport.onDisconnect = (error) => {
                this.log(`Disconnected from SIP server: ${error || "Unknown reason"}`);
                this.updateUI(false);
            };
        }

        async register() {
            try {
                await this.registerer.register();
                this.log("Registration sent");
            } catch (error) {
                this.log(`Registration error: ${error.message}`);
                throw error;
            }
        }

        handleRegistrationState(state) {
            switch (state) {
                case SIP.RegistererState.Registered:
                    this.registered = true;
                    UI.statusIndicator.style.background = 'green';
                    this.updateUI(true);
                    this.log("Successfully registered");
                    break;
                case SIP.RegistererState.Unregistered:
                case SIP.RegistererState.Terminated:
                    this.registered = false;
                    UI.statusIndicator.style.background = 'red';
                    this.updateUI(false);
                    this.log(state === SIP.RegistererState.Unregistered ? "Unregistered" : "Registration terminated");
                    break;
            }
        }

        // Call Operations
        async makeCall(extension) {
            if (!this.registered) throw new Error('Not registered');

            const targetURI = SIP.UserAgent.makeURI(`sip:${extension}@${this.credentials.domain}`);
            if (!targetURI) throw new Error('Invalid target URI');

            this.log(`Initiating call to ${extension}`);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            UI.localVideo.srcObject = stream;

            this.session = new SIP.Inviter(this.userAgent, targetURI);
            this.setupSessionListeners();

            await this.session.invite({
                sessionDescriptionHandlerOptions: {
                    constraints: { audio: true, video: false },
                    localMediaStream: stream
                }
            });

            this.updateCallStatus(`Calling: ${extension}...`);
        }

        handleIncomingCall(invitation) {
            this.session = invitation;
            this.setupSessionListeners();
            UI.buttons.answer.style.display = 'block';
            this.updateCallStatus(`Incoming call from: ${invitation.remoteIdentity.uri.user}`);
        }

        async answerCall() {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            UI.localVideo.srcObject = stream;

            await this.session.accept({
                sessionDescriptionHandlerOptions: {
                    constraints: { audio: true, video: false },
                    localMediaStream: stream
                }
            });

            UI.buttons.answer.style.display = 'none';
        }

        hangupCall() {
            if (!this.session) return;

            this.log("Ending call");
            if (this.session.state === SIP.SessionState.Established) {
                this.session.bye().catch(err => this.log(`Error ending call: ${err.message}`));
            } else {
                this.session.cancel().catch(err => this.log(`Error canceling call: ${err.message}`));
            }
            this.clearSession();
        }

        // DTMF Implementation
        sendDTMF(digit) {
            if (!this.session || this.session.state !== SIP.SessionState.Established) {
                this.log("No active call for DTMF");
                return;
            }

            this.log(`Sending DTMF: ${digit}`);
            this.session.sessionDescriptionHandler.sendDtmf(digit, {
                duration: CONFIG.DTMF_DURATION,
                interToneGap: CONFIG.DTMF_GAP
            });
        }

        // Session Management
        setupSessionListeners() {
            this.session.stateChange.addListener(state => {
                this.log(`Call state: ${state}`);
                if (state === SIP.SessionState.Established) {
                    this.updateCallStatus(`Connected with: ${this.session.remoteIdentity.uri.user}`);
                    UI.buttons.answer.style.display = 'none';
                    this.attachRemoteStream();
                    this.updateUIButtons();
                } else if (state === SIP.SessionState.Terminated) {
                    this.clearSession();
                }
            });

            this.session.delegate = {
                onSessionDescriptionHandler: sdh => {
                    sdh.peerConnectionDelegate = {
                        ontrack: event => {
                            if (event.track.kind === 'audio') {
                                const stream = UI.remoteVideo.srcObject || new MediaStream();
                                event.streams[0].getTracks().forEach(track => stream.addTrack(track));
                                UI.remoteVideo.srcObject = stream;
                            }
                        }
                    };
                }
            };
        }

        attachRemoteStream() {
            const pc = this.session.sessionDescriptionHandler.peerConnection;
            const remoteStream = new MediaStream();
            pc.getReceivers().forEach(receiver => {
                if (receiver.track) remoteStream.addTrack(receiver.track);
            });
            UI.remoteVideo.srcObject = remoteStream;
            this.log("Remote audio attached");
        }

        clearSession() {
            if (UI.localVideo.srcObject) {
                UI.localVideo.srcObject.getTracks().forEach(track => track.stop());
                UI.localVideo.srcObject = null;
            }
            if (UI.remoteVideo.srcObject) UI.remoteVideo.srcObject = null;

            this.session = null;
            UI.buttons.answer.style.display = 'none';
            this.updateCallStatus('No active call');
            this.updateUIButtons();
        }

// Audio Controls
        // Add this helper method to modify SDP for hold
        modifyHoldSDP(sdp, hold) {
            const lines = sdp.split('\r\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('m=audio')) {
                    // Update media direction
                    if (hold) {
                        // Set to inactive for hold
                        lines.splice(i + 1, 0, 'a=inactive');
                    } else {
                        // Remove inactive for unhold
                        if (lines[i + 1]?.startsWith('a=inactive')) {
                            lines.splice(i + 1, 1);
                        }
                        // Ensure sendrecv is present
                        if (!lines.some(line => line.startsWith('a=sendrecv'))) {
                            lines.splice(i + 1, 0, 'a=sendrecv');
                        }
                    }
                    break;
                }
            }
            return lines.join('\r\n');
        }

        toggleMute(enabled) {
            const pc = this.session?.sessionDescriptionHandler?.peerConnection;
            if (!pc) {
                this.log("No active call to mute");
                return;
            }

            pc.getSenders().forEach(sender => {
                if (sender.track?.kind === 'audio') {
                    sender.track.enabled = enabled;
                }
            });
            this.log(enabled ? "Call unmuted" : "Call muted");
        }

        async toggleHold(hold) {
            if (!this.session || !this.session.sessionDescriptionHandler) {
                this.log("No active call to hold");
                throw new Error("No active call");
            }

            try {
                // Get current local stream
                const stream = UI.localVideo.srcObject || await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

                // Create hold/unhold INVITE options
                const options = {
                    sessionDescriptionHandlerOptions: {
                        constraints: { audio: true, video: false },
                        localMediaStream: stream,
                        onSessionDescriptionHandlerCreated: (sdh) => {
                            // Modify SDP before sending
                            const originalGetDescription = sdh.getDescription;
                            sdh.getDescription = async (options) => {
                                const desc = await originalGetDescription.call(sdh, options);
                                desc.sdp = this.modifyHoldSDP(desc.sdp, hold);
                                return desc;
                            };
                        }
                    }
                };

                // Send re-INVITE
                await this.session.invite(options);
                
                // Only modify local audio state after successful hold
                if (hold) {
                    this.toggleMute(false); // Mute local audio when on hold
                } else {
                    this.toggleMute(true);  // Unmute local audio when resuming
                }

                this.log(hold ? "Call placed on hold" : "Call resumed from hold");
                UI.buttons.hold.disabled = hold;
                UI.buttons.unhold.disabled = !hold;

            } catch (error) {
                this.log(`Hold operation failed: ${error.message}`);
                // Restore audio state on failure
                this.toggleMute(true);
                throw error;
            }
        }

        async transfer(extension) {
            const target = SIP.UserAgent.makeURI(`sip:${extension}@${this.credentials.domain}`);
            if (!target) throw new Error('Invalid transfer target');
            
            this.log(`Transferring to ${extension}`);
            await this.session.refer(target);
        }

        // UI Updates
        updateCallStatus(status) {
            UI.activeCall.textContent = status;
        }

        updateUI(isRegistered) {
            UI.forms.sip.style.display = isRegistered ? 'none' : 'block';
            UI.forms.call.style.display = isRegistered ? 'block' : 'none';
            this.updateUIButtons();
        }

        updateUIButtons() {
            const activeCall = this.session && this.session.state !== SIP.SessionState.Terminated;
            Object.values(UI.buttons).forEach(btn => {
                if (btn !== UI.buttons.answer) btn.disabled = !activeCall;
            });
            UI.buttons.call.disabled = activeCall;
            UI.buttons.unregister.disabled = activeCall;
        }

        // Cleanup
        async unregister() {
            await this.registerer.unregister();
            await this.userAgent.stop();
            this.userAgent = null;
            this.registerer = null;
            this.registered = false;
            this.clearSession();
            this.updateUI(false);
            this.log("Unregistered and stopped");
        }
    }

    // Initialize Call Manager
    const callManager = new CallManager();

    // Event Handlers
    UI.forms.sip.onsubmit = async e => {
        e.preventDefault();
        try {
            await callManager.configureSIP(e.target);
        } catch (e) {
            callManager.log(`SIP config error: ${e.message}`);
        }
    };

    UI.forms.call.onsubmit = async e => {
        e.preventDefault();
        try {
            await callManager.makeCall(UI.extension.value);
        } catch (e) {
            callManager.log(`Call error: ${e.message}`);
        }
    };

    function addDigit(e, digit) {
        e.preventDefault();
        UI.extension.value += digit;
        if (callManager.session?.state === SIP.SessionState.Established) {
            callManager.sendDTMF(digit);
        }
    }

    function clearDialedNumber() {
        UI.extension.value = '';
    }

    // Exposed Controls
    window.onAnswerClick = () => callManager.answerCall();
    window.onHangupClick = () => callManager.hangupCall();
    window.mute = () => callManager.toggleMute(false);
    window.unmute = () => callManager.toggleMute(true);
    window.hold = () => callManager.toggleHold(true);
    window.unhold = () => callManager.toggleHold(false);
    window.transfer = () => callManager.transfer(UI.extension.value);
    window.unregisterSipUser = () => callManager.unregister();

    // Periodic UI refresh
    setInterval(() => callManager.updateUIButtons(), 150);
