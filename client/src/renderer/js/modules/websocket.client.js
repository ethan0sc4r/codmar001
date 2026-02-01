export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.messageHandlers = new Map();

    this.stats = {
      messagesReceived: 0,
      reconnectCount: 0,
      lastMessageTime: null,
    };
  }

  connect() {
    console.log(`Connecting to WebSocket: ${this.url}`);

    try {
      this.ws = new WebSocket(this.url);

      this.ws.addEventListener('open', () => {
        this.onOpen();
      });

      this.ws.addEventListener('message', (event) => {
        this.onMessage(event);
      });

      this.ws.addEventListener('close', () => {
        this.onClose();
      });

      this.ws.addEventListener('error', (error) => {
        this.onError(error);
      });

    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.scheduleReconnect();
    }
  }

  onOpen() {
    console.log('✓ WebSocket connected');
    this.connected = true;
    this.reconnectAttempts = 0;

    this.emit('connected');
  }

  onMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this.stats.messagesReceived++;
      this.stats.lastMessageTime = Date.now();

      const messageType = message.type;

      const handler = this.messageHandlers.get(messageType);
      if (handler) {
        handler(message);
      } else if (messageType === 'connected') {
        console.log('Server:', message.message || 'Connected');
        this.emit('connected', message);
      } else if (messageType === 'heartbeat' || messageType === 'pong') {
      } else if (messageType === 'watchlist_sync') {
        console.log('Watchlist synced:', message.vessels, 'vessels,', message.lists, 'lists');
        this.emit('watchlist_sync', message);
      } else {
        console.warn('Unknown message type:', messageType, message);
      }

    } catch (error) {
      console.error('Failed to parse message:', error, event.data);
    }
  }

  onClose() {
    console.log('✗ WebSocket disconnected');
    this.connected = false;
    this.ws = null;

    this.emit('disconnected');

    this.scheduleReconnect();
  }

  onError(error) {
    console.error('WebSocket error:', error);
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.emit('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnectCount++;

    console.log(`Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.ws) {
      console.log('Disconnecting WebSocket');
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  on(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  emit(event, data) {
    const handler = this.messageHandlers.get(event);
    if (handler) {
      handler(data);
    }
  }

  send(message) {
    if (this.connected && this.ws) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: not connected');
    }
  }

  isConnected() {
    return this.connected;
  }

  getStats() {
    return { ...this.stats };
  }
}
