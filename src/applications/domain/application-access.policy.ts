import { Injectable } from '@nestjs/common';
import { AuthUser } from '../../common/auth-user';
import { Role } from '../../users/role.enum';
import { MerchantApplication } from '../merchant-application.entity';

export interface ApplicationScope {
  createdById?: string;
  assignedReviewerId?: string;
}

@Injectable()
export class ApplicationAccessPolicy {
  scopeFor(user: AuthUser): ApplicationScope {
    switch (user.role) {
      case Role.ADMIN:
        return {};
      case Role.SALES:
        return { createdById: user.id };
      case Role.REVIEWER:
        return { assignedReviewerId: user.id };
    }
  }

  canView(user: AuthUser, application: MerchantApplication): boolean {
    const scope = this.scopeFor(user);
    if (scope.createdById && application.createdById !== scope.createdById) return false;
    if (scope.assignedReviewerId && application.assignedReviewerId !== scope.assignedReviewerId) {
      return false;
    }
    return true;
  }

  canEdit(user: AuthUser, application: MerchantApplication): boolean {
    if (user.role === Role.ADMIN) return true;
    return user.role === Role.SALES && application.createdById === user.id;
  }

  canAssign(user: AuthUser): boolean {
    return user.role === Role.ADMIN;
  }

  canDecide(user: AuthUser, application: MerchantApplication): boolean {
    return user.role === Role.REVIEWER && application.assignedReviewerId === user.id;
  }

  canRetryRiskReview(user: AuthUser): boolean {
    return user.role === Role.ADMIN;
  }
}
