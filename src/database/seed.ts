import * as bcrypt from 'bcryptjs';
import dataSource from './data-source';
import { User } from '../users/user.entity';
import { Role } from '../users/role.enum';

const users = [
  { email: 'admin@example.com', fullName: 'Demo Admin', role: Role.ADMIN },
  { email: 'reviewer@example.com', fullName: 'Demo Reviewer', role: Role.REVIEWER },
  { email: 'reviewer2@example.com', fullName: 'Second Reviewer', role: Role.REVIEWER },
  { email: 'sales@example.com', fullName: 'Demo Sales', role: Role.SALES },
  { email: 'sales2@example.com', fullName: 'Second Sales', role: Role.SALES },
];

async function seed() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('Set SEED_PASSWORD (min 12 characters) before seeding');
  }

  await dataSource.initialize();
  const repository = dataSource.getRepository(User);
  const passwordHash = await bcrypt.hash(password, 12);

  for (const user of users) {
    await repository
      .createQueryBuilder()
      .insert()
      .values({ ...user, passwordHash })
      .orIgnore()
      .execute();
  }

  console.log(`Seeded ${users.length} users`);
  await dataSource.destroy();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
