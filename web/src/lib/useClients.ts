// The client list, for screens that name a client beside a row (alerts, the queue).
import { useEffect, useState } from 'react'
import { api } from './api'
import type { Client } from './types'

export function useClients() {
  const [clients, setClients] = useState<Client[]>([])
  useEffect(() => {
    api
      .clients()
      .then((r) => setClients(r.projects))
      .catch(() => {})
  }, [])
  const nameOf = (id: string) => clients.find((c) => c.id === id)?.name || 'A removed client'
  return { clients, nameOf }
}
