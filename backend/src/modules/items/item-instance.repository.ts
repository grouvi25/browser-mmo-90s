import { prisma } from '../../shared/db/prisma'
import type { ItemInstance, ItemTemplate } from '@prisma/client'

export type ItemWithTemplate = ItemInstance & { template: ItemTemplate }

export const ItemsRepository = {
  async findInstanceById(id: string): Promise<ItemWithTemplate | null> {
    return prisma.itemInstance.findUnique({
      where: { id },
      include: { template: true },
    })
  },

  async findByOwner(ownerId: string): Promise<ItemWithTemplate[]> {
    return prisma.itemInstance.findMany({
      // Использованные расходники (CONSUMED) и удалённые (DELETED) не показываем в инвентаре
      where: { ownerId, status: { notIn: ['DELETED', 'CONSUMED'] } },
      include: { template: true },
      orderBy: { createdAt: 'desc' },
    })
  },

  async findEquipped(ownerId: string): Promise<ItemWithTemplate[]> {
    return prisma.itemInstance.findMany({
      where: { ownerId, isEquipped: true, status: { not: 'DELETED' } },
      include: { template: true },
    })
  },

  async findEquippedBySlot(ownerId: string, slot: string): Promise<ItemWithTemplate | null> {
    return prisma.itemInstance.findFirst({
      where: { ownerId, isEquipped: true, armorSlot: slot as ItemInstance['armorSlot'], status: { not: 'DELETED' } },
      include: { template: true },
    })
  },

  async findEquippedWeapons(ownerId: string): Promise<{ LEFT_HAND: ItemWithTemplate | null; RIGHT_HAND: ItemWithTemplate | null }> {
    const weapons = await prisma.itemInstance.findMany({
      where: { ownerId, isEquipped: true, template: { type: 'WEAPON' }, status: { not: 'DELETED' } },
      include: { template: true },
      orderBy: { createdAt: 'asc' },
    })
    const legacy = weapons.find(item => item.armorSlot == null) ?? null
    return {
      LEFT_HAND: weapons.find(item => item.armorSlot === 'LEFT_HAND') ?? legacy,
      RIGHT_HAND: weapons.find(item => item.armorSlot === 'RIGHT_HAND') ?? null,
    }
  },

  async findEquippedWeapon(ownerId: string): Promise<ItemWithTemplate | null> {
    // Ищем оружие: тип WEAPON, в слоте LEFT_HAND (новый) или без слота (старый стиль)
    return prisma.itemInstance.findFirst({
      where: {
        ownerId,
        isEquipped: true,
        template: { type: 'WEAPON' },
        status: { not: 'DELETED' },
      },
      include: { template: true },
    })
  },

  // Найти щит в правой руке
  async findEquippedShield(ownerId: string): Promise<ItemWithTemplate | null> {
    return prisma.itemInstance.findFirst({
      where: {
        ownerId,
        isEquipped: true,
        armorSlot: 'RIGHT_HAND',
        status: { not: 'DELETED' },
      },
      include: { template: true },
    })
  },

  async create(data: {
    templateId: string
    ownerId: string
    quality: string
    durabilityCurrent: number
    durabilityMax: number
    weight: number
    sourceType: string
  }): Promise<ItemInstance> {
    return prisma.itemInstance.create({ data: data as Parameters<typeof prisma.itemInstance.create>[0]['data'] })
  },

  async equip(id: string, slot: string | null): Promise<void> {
    await prisma.itemInstance.update({
      where: { id },
      data: { isEquipped: true, status: 'EQUIPPED', armorSlot: slot as ItemInstance['armorSlot'] },
    })
  },

  async unequip(id: string): Promise<void> {
    await prisma.itemInstance.update({
      where: { id },
      data: { isEquipped: false, status: 'NORMAL', armorSlot: null },
    })
  },

  async updateDurability(id: string, durabilityCurrent: number): Promise<void> {
    const status = durabilityCurrent <= 0 ? 'BROKEN' : undefined
    await prisma.itemInstance.update({
      where: { id },
      data: { durabilityCurrent, ...(status ? { status } : {}) },
    })
  },

  async updateStatus(id: string, status: string): Promise<void> {
    await prisma.itemInstance.update({
      where: { id },
      data: { status: status as ItemInstance['status'] },
    })
  },

  async delete(id: string): Promise<void> {
    await prisma.itemInstance.update({
      where: { id },
      data: { status: 'DELETED', isEquipped: false },
    })
  },
}
