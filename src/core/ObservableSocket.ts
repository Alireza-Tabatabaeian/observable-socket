import {ComplexTypes, Message} from "./Message"

type Response = { message: Message | null; success: boolean }
export type OnMessage = (response: Response) => void

const MAX_TIMEOUT = 1800000
const MIN_QUE_TIMEOUT = 2000

export type SocketConfig = {
    queManager: boolean
    queRunTimeout: number
    requestTimeout: number
    maxReconnectAttempts: number
    heartbeatRate: number
    heartbeatTimeoutDuration: number
    globalHeaders: Record<string, ComplexTypes>
}

export const socketConfig: SocketConfig = {
    queManager: false,
    queRunTimeout: 5000,
    requestTimeout: 30000,
    maxReconnectAttempts: 5,
    heartbeatRate: 60000,
    heartbeatTimeoutDuration: 59000,
    globalHeaders: {},
}

type QueItem = {
    onMessage: OnMessage
    expire?: number
}

export class ObservableSocket {
    private readonly name: string
    socket?: WebSocket

    private pendingRequests: Map<string, QueItem> = new Map()

    onMessageReceived?: OnMessage
    onSocketConnectionChange?: (name: string, state: boolean) => void

    private manuallyClosed = false

    private reconnectAttempts = 0
    private heartbeatInterval: number | null = null
    private heartbeatTimeout: number | null = null
    private queManagerInterval: number | null = null

    private readonly requestTimeout: number
    private readonly queManagerTimeout: number
    private readonly maxReconnectAttempts: number
    private readonly heartbeatRate: number
    private readonly heartbeatTimeoutDuration: number
    private readonly enableQueManager: boolean

    private readonly globalHeaders: Record<string, ComplexTypes>

    constructor(
        name: string,
        socketUrl: string,
        onSocketConnectChanged?: (name: string, state: boolean) => void,
        onMessageReceived?: OnMessage,
        userConfig?: Partial<SocketConfig>,
    ) {
        const config: SocketConfig = Object.assign({}, socketConfig, userConfig)

        this.requestTimeout =
            config.requestTimeout > MAX_TIMEOUT
                ? MAX_TIMEOUT
                : config.requestTimeout < MIN_QUE_TIMEOUT
                    ? MIN_QUE_TIMEOUT
                    : config.requestTimeout

        this.queManagerTimeout = config.queRunTimeout
        this.maxReconnectAttempts = config.maxReconnectAttempts
        this.heartbeatRate = config.heartbeatRate
        this.heartbeatTimeoutDuration = config.heartbeatTimeoutDuration
        this.enableQueManager = config.queManager

        this.name = name
        this.globalHeaders = config.globalHeaders
        this.onSocketConnectionChange = onSocketConnectChanged
        this.onMessageReceived = onMessageReceived

        this.connect(socketUrl, this.enableQueManager)
    }

    private connect(socketUrl: string, enableQueManager?: boolean) {
        this.socket = new WebSocket(socketUrl)
        this.manuallyClosed = false

        this.socket.onopen = () => {
            this.onSocketConnectionChange?.(this.name, true)
            this.reconnectAttempts = 0
            this.startHeartbeat()
            if (enableQueManager === true) {
                this.startQueManager()
            }
        }

        this.socket.onmessage = (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data as string) as Message

                if (message.route === "PONG") {
                    if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
                    return
                }

                this.onMessageReceived?.({message, success: true})

                const pending = this.pendingRequests.get(message.uuid)
                if (pending) {
                    pending.onMessage({message, success: true})
                    this.pendingRequests.delete(message.uuid)
                }
            } catch (error) {
                console.error("Invalid WebSocket message:", error)
            }
        }

        this.socket.onerror = (error) => {
            console.error("WebSocket error:", error)
        }

        this.socket.onclose = (event) => {
            this.stopQueManager()
            this.stopHeartbeat()

            // Fail all pending requests
            this.pendingRequests.forEach((q) => q.onMessage({message: null, success: false}))
            this.pendingRequests.clear()

            this.onSocketConnectionChange?.(this.name, false)

            // Server policy/intentional close? do not reconnect
            if ([1008, 1011].includes(event.code)) {
                console.error("Server closed connection due to authentication or policy violation.")
                return
            }

            // Manual close? do not reconnect
            if (this.manuallyClosed) return

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const base = 1000
                const max = 15000
                const backoff = Math.min(max, base * 2 ** this.reconnectAttempts)
                const jitter = Math.random() * 300
                setTimeout(() => {
                    this.reconnectAttempts++
                    this.connect(socketUrl, enableQueManager) // keep the same behavior
                }, backoff + jitter)
            } else {
                console.error("Max reconnect attempts reached.")
            }
        }
    }

    private startQueManager() {
        if (this.queManagerInterval) clearInterval(this.queManagerInterval)

        this.queManagerInterval = setInterval(() => {
            this.pendingRequests.forEach((queItem: QueItem, uuid: string, map) => {
                if (queItem.expire && queItem.expire < Date.now()) {
                    queItem.onMessage({message: null, success: false})
                    map.delete(uuid)
                }
            })
        }, this.queManagerTimeout) as unknown as number
    }

    private stopQueManager() {
        if (this.queManagerInterval) {
            clearInterval(this.queManagerInterval)
            this.queManagerInterval = null
        }
    }

    private startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)

        this.heartbeatInterval = setInterval(() => {
            if (this.socket?.readyState === WebSocket.OPEN) {
                this.sendMessage(new Message("PING", {}))

                if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout)
                this.heartbeatTimeout = setTimeout(() => {
                    console.warn("No PONG received! Closing WebSocket...")
                    this.socket?.close()
                }, this.heartbeatTimeoutDuration) as unknown as number
            }
        }, this.heartbeatRate) as unknown as number
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval)
            this.heartbeatInterval = null
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout)
            this.heartbeatTimeout = null
        }
    }

    sendMessage(message: Message) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            // Merge global headers if they don't exist in the message
            message.headers = {...this.globalHeaders, ...message.headers}
            this.socket.send(message.serialize())
        } else {
            console.error("Cannot send message: WebSocket is not connected.")
        }
    }

    onResponse(request: Message, onReceivedAction: (response: Response) => unknown) {
        request.headers = {...this.globalHeaders, ...request.headers}
        this.pendingRequests.set(request.uuid, {
            expire: Date.now() + this.requestTimeout,
            onMessage: onReceivedAction,
        })
        this.sendMessage(request)
    }

    sendAndWait = (message: Message) => {
        return new Promise<Response>((resolve, reject) => {
            if (this.socket?.readyState !== WebSocket.OPEN) {
                return reject(new Error("WebSocket is not connected."))
            }
            this.onResponse(message, resolve)
        })
    }

    close() {
        this.manuallyClosed = true
        // Stop timers immediately (defensive)
        this.stopQueManager()
        this.stopHeartbeat()
        this.socket?.close()
    }
}
