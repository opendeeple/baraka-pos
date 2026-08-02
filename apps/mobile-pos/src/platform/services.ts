// App-wide service singletons: DB adapter, repositories, sync engine, stores.
import * as Crypto from 'expo-crypto'
import { createSyncEngine, type SyncEngine } from '@baraka/sync-engine'
import { createRepositories, type Repositories } from '@baraka/data'
import { createCartStore, type CartStoreHook } from '@baraka/app-core'
import { createDbAdapter } from './database'

export interface Services {
  repos: Repositories
  engine: SyncEngine
  useCartStore: CartStoreHook
}

let services: Services | null = null

export function getServices(): Services {
  if (services) return services
  const db = createDbAdapter()
  const uuid = () => Crypto.randomUUID()
  const engine = createSyncEngine({ db, uuid, log: console.log })
  const repos = createRepositories(db, uuid, (table, syncId, op) =>
    engine.enqueueOutbox(table, syncId, op)
  )
  const useCartStore = createCartStore(repos.heldCarts)
  services = { repos, engine, useCartStore }
  return services
}
