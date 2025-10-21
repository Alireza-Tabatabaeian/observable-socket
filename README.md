# Observable Socket (Frontend, NPM)

Tiny reactive WebSocket client and context provider that let you **call WebSocket routes like HTTP endpoints** — designed for full compatibility with the companion Django/Channels backend [`django-channels-router`](https://pypi.org/project/django-channels-router/).

- ⚡ Call named routes with `sendAndWait()` — like `fetch()`, but over WebSocket.
- 🔁 Built-in heartbeat, reconnect, and timeout management.
- 🧩 Multiple sockets handled safely in React via `ObservableSocketProvider`.
- 💬 Cleanly typed messages with `uuid` correlation.
- 🧠 Global headers and per-socket config.

---

## Install

```bash
npm i @djanext/observable-socket
# or
pnpm add @djanext/observable-socket
```

---

## Quick Start (Vanilla)

```ts
import { ObservableSocket, Message } from "@djanext/observable-socket";

const ws = new ObservableSocket(
  "app",
  "wss://example.com/ws/app/",
  (name, connected) => console.log("Connected:", connected),
  (res) => console.log("Server says:", res),
  { requestTimeout: 15000, globalHeaders: { token: "XYZ" } }
)

const res = await ws.sendAndWait(new Message("sayHello", { name: "Alireza" }))
console.log(res.message?.payload) // "Hello, Alireza!"
```

---

## React Integration

```tsx
'use client'
import React from "react"
import { ObservableSocketProvider, useObservableSocket } from "@djanext/observable-socket"
import { Message } from "@djanext/observable-socket"

export default function App() {
  return (
    <ObservableSocketProvider>
      <Dashboard />
    </ObservableSocketProvider>
  );
}

function Dashboard() {
  const { addSocket, getSocket, removeSocket } = useObservableSocket();

  React.useEffect(() => {
    addSocket(
      "app",
      process.env.NEXT_PUBLIC_WS_URL!,
      (res) => console.log("Push:", res),
      false,
      { globalHeaders: { apiKey: "123" } }
    )
  }, [addSocket])

  const handleClick = async () => {
    const app = getSocket("app")
    if (!app) return alert("Socket not ready!")
    const result = await app.socket.sendAndWait(new Message("sayHello", { name: "World" }))
    console.log(result)
  }

  return <button onClick={handleClick}>Say Hello</button>
}
```


💡 Note: React is listed as a peerDependency — only required if you use the ObservableSocketProvider or React hooks.
For non-React environments, import directly from `@djanext/observable-socket/core`.

---

## API

### `ObservableSocket`

| Method | Description |
|--------|--------------|
| `sendMessage(message)` | Fire-and-forget send. |
| `sendAndWait(message)` | Returns a Promise resolved with `{ message, success }`. |
| `onResponse(request, callback)` | Register a one-off response handler. |
| `close()` | Manually close the socket (stops heartbeats). |

### `ObservableSocketProvider` (React)

| Function | Description |
|-----------|-------------|
| `addSocket(name, url, onMessage?, force?, config?)` | Creates a new socket. If name exists and `force` is not `true`, returns `{ ok:false, reason:'exists', item }`. |
| `getSocket(name)` | Returns `{ socket, socketState }`. |
| `removeSocket(name)` | Closes and removes a socket by name. |

**Config Options (`Partial<SocketConfig>`)**

| Option | Default | Description |
|--------|----------|-------------|
| `requestTimeout` | 30000 | Per-request timeout (ms) |
| `queManager` | false | Enable expiry check for pending requests |
| `heartbeatRate` | 60000 | Interval between PINGs |
| `heartbeatTimeoutDuration` | 59000 | Wait before assuming no PONG |
| `maxReconnectAttempts` | 5 | Max automatic retries |
| `globalHeaders` | `{}` | Headers merged into all messages |

---

## Example Message

```json
{
  "uuid": "9b7c...",
  "route": "sayHello",
  "headers": { "token": "XYZ" },
  "payload": { "name": "Ali" },
  "status": 200
}
```

---

## Multi-Socket & Race-Safety Notes

- Functional `setState` avoids stale closures.
- Each socket instance gets a random `instanceId` → old sockets can’t overwrite new states.
- Prevents duplicate connections unless `force = true`.
- Includes `removeSocket()` for safe cleanup (used internally on unmount).

---

## Server Side

Use the Django/Channels package [`observable-socket-router`](https://pypi.org/project/observable-socket-router/)  
It handles route mapping, hydrate/dehydrate, and status responses.

---

## License

MIT
