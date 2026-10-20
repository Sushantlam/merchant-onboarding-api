import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { Role } from './role.enum';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async create(dto: CreateUserDto): Promise<User> {
    const exists = await this.users.exist({ where: { email: dto.email } });
    if (exists) throw new ConflictException('A user with this email already exists');

    const user = this.users.create({
      email: dto.email,
      fullName: dto.fullName,
      role: dto.role,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
    });
    return this.users.save(user);
  }

  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  findAll(role?: Role): Promise<User[]> {
    return this.users.find({ where: role ? { role } : {}, order: { createdAt: 'ASC' } });
  }
}
