import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Store
  const store = await prisma.store.upsert({
    where: { id: 1 },
    update: {
      name: 'Baraka Mini Market',
      address: 'Yunusobod tumani, Toshkent',
      phone: '+998 71 000 0000',
      email: 'baraka@minimarket.uz',
      timezone: 'Asia/Tashkent',
    },
    create: {
      name: 'Baraka Mini Market',
      address: 'Yunusobod tumani, Toshkent',
      phone: '+998 71 000 0000',
      email: 'baraka@minimarket.uz',
      salePrefix: 'BRK',
      currentSaleNumber: 0,
      timezone: 'Asia/Tashkent',
    },
  })
  console.log(`  ✅ Store: ${store.name}`)

  // Admin user
  const adminHash = await bcrypt.hash('admin123', 10)
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      storeId: store.id,
      name: 'Admin User',
      email: 'admin@baraka.uz',
      username: 'admin',
      passwordHash: adminHash,
      role: 'admin',
      pinCode: '1234',
    },
  })
  console.log(`  ✅ Admin: ${admin.username} / admin123`)

  // Cashier user
  const cashierHash = await bcrypt.hash('cashier123', 10)
  const cashier = await prisma.user.upsert({
    where: { username: 'cashier1' },
    update: {},
    create: {
      storeId: store.id,
      name: 'Zulfiya',
      email: 'zulfiya@baraka.uz',
      username: 'cashier1',
      passwordHash: cashierHash,
      role: 'cashier',
      pinCode: '5678',
    },
  })
  console.log(`  ✅ Cashier: ${cashier.username} / cashier123`)

  // Collections (categories)
  const categories = [
    { name: 'Ichimliklar', slug: 'beverages' },
    { name: 'Gazaklar', slug: 'snacks' },
    { name: 'Sut mahsulotlari', slug: 'dairy' },
    { name: 'Non mahsulotlari', slug: 'bakery' },
    { name: 'Maishiy tovarlar', slug: 'household' },
    { name: 'Shaxsiy gigiyena', slug: 'personal-care' },
    { name: 'Don va yorma', slug: 'grains-cereals' },
    { name: 'Go\'sht va parranda', slug: 'meat-poultry' },
    { name: 'Muzlatilgan oziq-ovqat', slug: 'frozen-foods' },
    { name: 'Tamaki', slug: 'tobacco' },
  ]

  const createdCategories: Record<string, number> = {}
  for (const cat of categories) {
    const c = await prisma.collection.upsert({
      where: { slug: cat.slug } as never,
      update: { name: cat.name },
      create: { collectionType: 'category', name: cat.name, slug: cat.slug },
    })
    createdCategories[cat.slug] = c.id
  }
  console.log(`  ✅ ${categories.length} categories created`)

  // Default charges — Uzbekistan VAT is 12%
  await prisma.charge.upsert({
    where: { id: 1 },
    update: { name: 'QQS 12%', rateValue: 12 },
    create: {
      storeId: store.id,
      name: 'QQS 12%',
      chargeType: 'tax',
      rateType: 'percentage',
      rateValue: 12,
      isActive: true,
      isDefault: true,
    },
  })
  console.log(`  ✅ Default charge: QQS (VAT) 12%`)

  // Clear existing products so re-seed gives clean prices
  await prisma.productStock.deleteMany()
  await prisma.productBatch.deleteMany()
  await prisma.collectionProduct.deleteMany()
  await prisma.product.deleteMany()

  // Sample products with real Uzbekistan market prices (UZS, 2024-2025)
  const sampleProducts = [
    // Ichimliklar (Beverages)
    { name: 'Coca-Cola 500ml',      barcode: '5449000000996', sku: 'BEV001', category: 'beverages',      cost: 8000,  price: 12000 },
    { name: 'Pepsi 500ml',          barcode: '4860051140063', sku: 'BEV002', category: 'beverages',      cost: 7500,  price: 11000 },
    { name: 'Tashkent suvi 1.5L',   barcode: '6281056991002', sku: 'BEV003', category: 'beverages',      cost: 3000,  price: 5000  },
    { name: 'Lipton choy 100 pak',  barcode: '6281056991088', sku: 'BEV004', category: 'beverages',      cost: 22000, price: 32000 },
    { name: 'Nescafe Classic 200g', barcode: '6281056991095', sku: 'BEV005', category: 'beverages',      cost: 65000, price: 90000 },
    // Gazaklar (Snacks)
    { name: 'Lays 50g',             barcode: '6281006992014', sku: 'SNK001', category: 'snacks',         cost: 9000,  price: 14000 },
    { name: 'Pringles 165g',        barcode: '6281006992021', sku: 'SNK002', category: 'snacks',         cost: 28000, price: 40000 },
    { name: 'Snickers 50g',         barcode: '6281006992038', sku: 'SNK003', category: 'snacks',         cost: 10000, price: 15000 },
    { name: 'Kit Kat 40g',          barcode: '6281006992045', sku: 'SNK004', category: 'snacks',         cost: 9000,  price: 14000 },
    // Sut mahsulotlari (Dairy)
    { name: 'Sut 1L (Sog\'lom)',    barcode: '6291003513070', sku: 'DAI001', category: 'dairy',          cost: 9000,  price: 13000 },
    { name: 'Qatiq 500g',           barcode: '6291003513087', sku: 'DAI002', category: 'dairy',          cost: 7000,  price: 10000 },
    { name: 'Sariyog\' 200g',       barcode: '6291003513094', sku: 'DAI003', category: 'dairy',          cost: 18000, price: 25000 },
    { name: 'Tvorog 400g',          barcode: '6291003513100', sku: 'DAI004', category: 'dairy',          cost: 14000, price: 20000 },
    // Non mahsulotlari (Bakery)
    { name: 'Non (oq non)',         barcode: '6281056991019', sku: 'BAK001', category: 'bakery',         cost: 4000,  price: 6000  },
    { name: 'Lavash',               barcode: '6281056991026', sku: 'BAK002', category: 'bakery',         cost: 5000,  price: 8000  },
    // Don va yorma (Grains)
    { name: 'Shakar 1kg',           barcode: '6281056991033', sku: 'GRN001', category: 'grains-cereals', cost: 10000, price: 14000 },
    { name: 'Guruch (Devzira) 1kg', barcode: '6281056991040', sku: 'GRN002', category: 'grains-cereals', cost: 18000, price: 25000 },
    { name: 'Un 2kg (Aqlli)',       barcode: '6281056991057', sku: 'GRN003', category: 'grains-cereals', cost: 16000, price: 22000 },
    { name: 'Makaron 400g',         barcode: '6281056991064', sku: 'GRN004', category: 'grains-cereals', cost: 7000,  price: 10000 },
    // Maishiy tovarlar (Household)
    { name: 'Tide 450g',            barcode: '6281056991071', sku: 'HH001',  category: 'household',      cost: 22000, price: 32000 },
    { name: 'Fairy 500ml',          barcode: '6281056991078', sku: 'HH002',  category: 'household',      cost: 18000, price: 26000 },
    // Shaxsiy gigiyena (Personal Care)
    { name: 'Colgate 75ml',         barcode: '6281056991085', sku: 'PC001',  category: 'personal-care',  cost: 15000, price: 22000 },
    { name: 'Shampun Head&Shoulders 200ml', barcode: '6281056991092', sku: 'PC002', category: 'personal-care', cost: 28000, price: 40000 },
  ]

  for (const p of sampleProducts) {
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name: p.name,
        barcode: p.barcode,
        sku: p.sku,
        categoryId: createdCategories[p.category],
        productType: 'simple',
        isStockManaged: true,
        isActive: true,
        isFeatured: false,
        alertQuantity: 5,
      },
    })

    const batch = await prisma.productBatch.create({
      data: {
        productId: product.id,
        cost: p.cost,
        price: p.price,
        isActive: true,
      },
    })

    await prisma.productStock.create({
      data: {
        storeId: store.id,
        productId: product.id,
        batchId: batch.id,
        quantity: 100,
      },
    })
  }
  console.log(`  ✅ ${sampleProducts.length} sample products created with stock`)

  // Default settings
  const defaultSettings = [
    {
      metaKey: 'receipt_template',
      metaValue: {
        header: '{{storeName}}\n{{storeAddress}}\nTel: {{storePhone}}',
        footer: 'Xarid uchun rahmat!\nBarakaPOS tomonidan',
        showLogo: false,
        showBarcode: true,
        showCustomerName: true,
        paperWidth: 80,
      },
    },
    {
      metaKey: 'loyalty',
      metaValue: {
        enabled: true,
        earnRate: 1,
        redeemRate: 1,
        minRedeemPoints: 100,
      },
    },
    {
      metaKey: 'printer',
      metaValue: {
        connection: 'usb',
        ip: '',
        port: 9100,
        vendorId: '',
        productId: '',
      },
    },
  ]

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { storeId_metaKey: { storeId: store.id, metaKey: s.metaKey } },
      update: { metaValue: s.metaValue },
      create: { storeId: store.id, ...s },
    })
  }
  console.log(`  ✅ Default settings created`)

  console.log('\n🎉 Seed complete!')
  console.log('   Login: admin / admin123')
  console.log('   Login: cashier1 / cashier123')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
