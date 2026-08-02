import { prisma } from '../../config/database'

export async function getSetting(storeId: number, key: string) {
  return prisma.setting.findUnique({
    where: { storeId_metaKey: { storeId, metaKey: key } },
  })
}

export async function listSettings(storeId: number) {
  return prisma.setting.findMany({ where: { storeId } })
}

export async function upsertSetting(storeId: number, key: string, value: unknown) {
  return prisma.setting.upsert({
    where: { storeId_metaKey: { storeId, metaKey: key } },
    create: { storeId, metaKey: key, metaValue: value as never },
    update: { metaValue: value as never },
  })
}
