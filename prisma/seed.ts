/**
 * Seeds a usable starting point: one admin, the three departments named in the
 * brief, and a small amount of sample data so the PDF report can be checked
 * end-to-end before real data is entered.
 *
 *   npm run seed
 *
 * Safe to re-run: everything is upserted by a natural key. Sample assets and
 * requests are only created when the database has none, so re-seeding a live
 * system will not duplicate real records.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@company.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2024';

async function main() {
  console.log('Seeding…');

  // --- Departments --------------------------------------------------------
  const departments = [
    { name: 'Printing', code: 'PRT', description: 'Print production floor and finishing.' },
    { name: 'Workshop', code: 'WRK', description: 'Fabrication, maintenance and repair bay.' },
    { name: 'IT', code: 'IT', description: 'Computing, network and office equipment.' },
  ];

  const created: Record<string, string> = {};

  for (const department of departments) {
    const row = await prisma.department.upsert({
      where: { code: department.code },
      update: {},
      create: department,
    });
    created[department.code] = row.id;
    console.log(`  department: ${row.name} (${row.code})`);
  }

  // --- Admin --------------------------------------------------------------
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: 'System Administrator',
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
  console.log(`  admin: ${admin.email}`);

  // --- Sample data (first run only) --------------------------------------
  const assetCount = await prisma.asset.count();

  if (assetCount === 0) {
    // Categories are created alongside the sample assets rather than with the
    // departments above: on a system that already holds real data, inventing
    // groups nobody asked for would be worse than adding nothing at all.
    console.log('  adding sample categories…');

    const categories = [
      { department: 'PRT', name: 'Printing press', code: 'PRS' },
      { department: 'PRT', name: 'Finishing', code: 'FIN' },
      { department: 'WRK', name: 'Machine tool', code: 'MCH' },
      { department: 'WRK', name: 'Welding', code: 'WLD' },
      { department: 'WRK', name: 'Shop utility', code: 'UTL' },
      { department: 'IT', name: 'Server', code: 'SRV' },
      { department: 'IT', name: 'Workstation', code: 'WKS' },
      { department: 'IT', name: 'Networking', code: 'NET' },
    ];

    const categoryIds: Record<string, string> = {};

    for (const category of categories) {
      const row = await prisma.assetCategory.upsert({
        where: {
          departmentId_name: {
            departmentId: created[category.department],
            name: category.name,
          },
        },
        update: {},
        create: {
          name: category.name,
          code: category.code,
          departmentId: created[category.department],
        },
      });
      categoryIds[`${category.department}:${category.name}`] = row.id;
    }

    console.log('  adding sample assets…');

    // Tags read department, category, number - PRT-PRS-001 is the first press
    // in Printing.
    const samples = [
      {
        assetTag: 'PRT-PRS-001', name: 'Heidelberg SM 52 Offset Press',
        categoryId: categoryIds['PRT:Printing press'],
        departmentId: created.PRT, status: 'IN_USE' as const, location: 'Print floor, bay 1',
        serialNumber: 'HD-SM52-88213', purchaseDate: new Date('2016-04-12'), purchaseCost: 145000,
        notes: 'Annual service due each March.',
      },
      {
        assetTag: 'PRT-FIN-001', name: 'Polar 78 Guillotine Cutter',
        categoryId: categoryIds['PRT:Finishing'],
        departmentId: created.PRT, status: 'NEEDS_REPLACEMENT' as const, location: 'Print floor, bay 2',
        serialNumber: 'PL78-44119', purchaseDate: new Date('2011-09-01'), purchaseCost: 28000,
        notes: 'Blade carriage worn; cut accuracy drifting beyond tolerance.',
      },
      {
        assetTag: 'PRT-PRS-002', name: 'Roland VersaCAMM Wide Format',
        categoryId: categoryIds['PRT:Printing press'],
        departmentId: created.PRT, status: 'IDLE' as const, location: 'Print floor, bay 3',
        purchaseDate: new Date('2019-02-20'), purchaseCost: 19500,
      },
      {
        assetTag: 'WRK-MCH-001', name: 'Bridgeport Milling Machine',
        categoryId: categoryIds['WRK:Machine tool'],
        departmentId: created.WRK, status: 'IN_USE' as const, location: 'Workshop, north wall',
        serialNumber: 'BP-J2-77401', purchaseDate: new Date('2009-06-15'), purchaseCost: 12000,
      },
      {
        assetTag: 'WRK-WLD-001', name: 'Miller MIG Welder 252',
        categoryId: categoryIds['WRK:Welding'],
        departmentId: created.WRK, status: 'BROKEN' as const, location: 'Workshop, welding bay',
        serialNumber: 'MI-252-31900', purchaseDate: new Date('2018-11-03'), purchaseCost: 4200,
        notes: 'Wire feed motor failed. Not economical to repair a third time.',
      },
      {
        assetTag: 'WRK-UTL-001', name: 'Air Compressor 200L',
        categoryId: categoryIds['WRK:Shop utility'],
        departmentId: created.WRK, status: 'IN_USE' as const, purchaseDate: new Date('2020-07-22'),
        purchaseCost: 1800,
      },
      {
        assetTag: 'IT-SRV-001', name: 'Dell PowerEdge R740 Server',
        categoryId: categoryIds['IT:Server'],
        departmentId: created.IT, status: 'IN_USE' as const, location: 'Server cupboard',
        serialNumber: 'DL-R740-9921X', purchaseDate: new Date('2021-03-30'), purchaseCost: 8600,
      },
      {
        assetTag: 'IT-WKS-001', name: 'Office Workstations (batch of 12)',
        categoryId: categoryIds['IT:Workstation'],
        departmentId: created.IT, status: 'NEEDS_REPLACEMENT' as const, location: 'Main office',
        purchaseDate: new Date('2017-01-10'), purchaseCost: 14400,
        notes: 'Out of warranty; will not take the current OS release.',
      },
      {
        assetTag: 'IT-NET-001', name: 'Ubiquiti Network Switch 48-port',
        categoryId: categoryIds['IT:Networking'],
        departmentId: created.IT, status: 'IN_USE' as const, location: 'Server cupboard',
        purchaseDate: new Date('2022-05-18'), purchaseCost: 950,
      },
    ];

    for (const sample of samples) {
      await prisma.asset.create({ data: sample });
    }

    console.log('  adding sample purchase requests…');

    const cutter = await prisma.asset.findUnique({ where: { assetTag: 'PRT-FIN-001' } });
    const welder = await prisma.asset.findUnique({ where: { assetTag: 'WRK-WLD-001' } });

    await prisma.purchaseRequest.createMany({
      data: [
        {
          title: 'Polar N 92 Plus Guillotine Cutter',
          category: 'Finishing',
          kind: 'REPLACEMENT',
          quantity: 1,
          estimatedCost: 42000,
          priority: 'HIGH',
          justification:
            'The existing cutter can no longer hold tolerance, which is causing rework on trimmed jobs. A replacement removes the recurring waste and the weekly re-calibration time.',
          departmentId: created.PRT,
          replacesAssetId: cutter?.id ?? null,
          requestedById: admin.id,
        },
        {
          title: 'Miller Multimatic 255 Welder',
          category: 'Welding',
          kind: 'REPLACEMENT',
          quantity: 1,
          estimatedCost: 5400,
          priority: 'CRITICAL',
          justification:
            'The current welder is out of service and the workshop cannot complete fabrication jobs without it. Third failure of the same component, so repair is no longer sensible.',
          departmentId: created.WRK,
          replacesAssetId: welder?.id ?? null,
          requestedById: admin.id,
        },
        {
          title: 'Replacement office workstations',
          category: 'Workstation',
          kind: 'REPLACEMENT',
          quantity: 12,
          estimatedCost: 1250,
          priority: 'MEDIUM',
          justification:
            'Existing machines are eight years old, out of warranty and cannot run the current supported operating system, which is becoming a security concern.',
          departmentId: created.IT,
          requestedById: admin.id,
        },
        {
          title: 'Backup NAS for off-site copies',
          category: 'Storage',
          kind: 'NEW',
          quantity: 1,
          estimatedCost: 3200,
          priority: 'MEDIUM',
          justification:
            'There is currently no second copy of business data. A NAS gives a nightly local backup target that can be rotated off-site.',
          departmentId: created.IT,
          requestedById: admin.id,
        },
      ],
    });
  }

  console.log('\nDone.');
  console.log(`\n  Sign in at /login`);
  console.log(`    email:    ${ADMIN_EMAIL}`);
  console.log(`    password: ${ADMIN_PASSWORD}`);
  console.log(`  You will be asked to change this password on first sign-in.\n`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
