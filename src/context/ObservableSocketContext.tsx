'use client'

import React, {createContext, useContext, useRef, useCallback, useState, useEffect} from 'react'
import {ObservableSocket, OnMessage, SocketConfig} from '../core'

type SocketItem = {
    socket: ObservableSocket
    socketState: boolean
}
type SocketHolder = Record<string, SocketItem>

type AddSocketResult =
    | { ok: true; item: SocketItem }
    | { ok: false; reason: 'exists'; item: SocketItem }  // returns the existing one for convenience

interface WebSocketManagerContext {
    addSocket: (
        name: string,
        url: string,
        onMessage?: OnMessage,
        force?: boolean,
        config?: Partial<SocketConfig>,
    ) => AddSocketResult
    getSocket: (name: string) => SocketItem | undefined
    removeSocket: (name: string) => boolean
}

const ObservableSocketContext = createContext<WebSocketManagerContext | null>(null)

export const ObservableSocketProvider: React.FC<{ children: React.ReactNode }> = ({children}) => {
    const [sockets, setSockets] = useState<SocketHolder>({} as SocketHolder)

    // Tracks the "current" live instance for each socket name to ignore stale events
    const instanceIdsRef = useRef<Record<string, string>>({})

    const getSocket = useCallback(
        (name: string): SocketItem | undefined =>
            Object.prototype.hasOwnProperty.call(sockets, name) ? sockets[name] : undefined,
        [sockets],
    )

    const removeSocket = useCallback((name: string) => {
        const existing = getSocket(name)
        if (!existing) return false
        try {
            existing.socket.close()
        } catch { /* ignore */ }
        setSockets(prev => {
            if (!Object.prototype.hasOwnProperty.call(prev, name)) return prev
            const copy = { ...prev }
            delete copy[name]
            return copy
        })
        delete instanceIdsRef.current[name]
        return true
    }, [getSocket])

    const addSocket = useCallback(
        (name: string, url: string, onMessage?: OnMessage, force?: boolean, config?: Partial<SocketConfig>): AddSocketResult => {
            const existing = getSocket(name)
            if (existing && !force) {
                // Return the existing item so callers can still use it
                return { ok: false, reason: 'exists', item: existing }
            }

            // Generate a fresh token for this instance
            const instanceId = crypto.randomUUID()
            instanceIdsRef.current[name] = instanceId

            // If replacing, close the old one first
            if (existing && force) {
                try { existing.socket.close() } catch { /* ignore */ }
            }

            const socketInstance = new ObservableSocket(
                name,
                url,
                // onStateChange(name, connected)
                (socketName: string, connected: boolean) => {
                    // Ignore events from stale socket instances
                    if (instanceIdsRef.current[socketName] !== instanceId) return
                    setSockets(prev => {
                        const curr = prev[socketName]
                        if (!curr) return prev
                        return { ...prev, [socketName]: { ...curr, socketState: connected } }
                    })
                },
                // onPush(response)
                onMessage,
                // per-socket config (headers, timeouts, etc.)
                config,
            )

            const isOpen = socketInstance.socket?.readyState === WebSocket.OPEN
            const item: SocketItem = { socket: socketInstance, socketState: isOpen }

            setSockets(prev => ({ ...prev, [name]: item }))

            return { ok: true, item }
        },
        [getSocket],
    )

    // Optional: auto-cleanup on unmount
    useEffect(() => {
        return () => {
            Object.values(sockets).forEach(({ socket }) => {
                try { socket.close() } catch { /* ignore */ }
            })
        }
    }, [sockets])

    return (
        <ObservableSocketContext.Provider value={{ addSocket, getSocket, removeSocket }}>
            {children}
        </ObservableSocketContext.Provider>
    )
}

// Custom hook for easy access
export const useObservableSocket = () => {
    const context = useContext(ObservableSocketContext)
    if (!context) {
        throw new Error('useObservableSocket must be used within a ObservableSocketProvider')
    }
    return context
}
