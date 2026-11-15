import { Module, forwardRef } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module.js'
import { MenusModule } from '../menus/menus.module.js'
import { AuthorizationModule } from '../rbac/authorization/authorization.module.js'
import { OrganizationModule } from '../rbac/organizations/organization.module.js'
import { CoordinatorActorPolicy } from './coordinator-actor-policy.service.js'
import { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { CoordinatorOverrideController } from './coordinator-override.controller.js'
import { CoordinatorOverrideService } from './coordinator-override.service.js'
import { CoordinatorController } from './coordinator.controller.js'
import { CounselorClassAssignmentController } from './counselor-class-assignment.controller.js'
import { CounselorClassAssignmentService } from './counselor-class-assignment.service.js'
import { StudentProfileController } from './student-profile.controller.js'
import { StudentProfileService } from './student-profile.service.js'
import { TeacherClassDutyController } from './teacher-class-duty.controller.js'
import { TeacherClassDutyService } from './teacher-class-duty.service.js'
import { TeacherProfileController } from './teacher-profile.controller.js'
import { TeacherProfileService } from './teacher-profile.service.js'

/**
 * 人员档案模块
 *
 * 本阶段只提供服务层，不暴露 HTTP 接口：
 * 组织范围、档案字段可见性等授权规则需要 Phase D/E 一起落地，
 * 避免在没有任何数据范围过滤的情况下开放档案读写。
 */
@Module({
  imports: [
    AuthModule,
    OrganizationModule,
    forwardRef(() => MenusModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [
    CoordinatorController,
    StudentProfileController,
    TeacherProfileController,
    TeacherClassDutyController,
    CounselorClassAssignmentController,
    CoordinatorOverrideController,
  ],
  providers: [
    CoordinatorActorPolicy,
    CoordinatorEligibilityService,
    CoordinatorLifecycleService,
    CoordinatorOverrideService,
    StudentProfileService,
    TeacherProfileService,
    TeacherClassDutyService,
    CounselorClassAssignmentService,
  ],
  exports: [
    CoordinatorEligibilityService,
    CoordinatorLifecycleService,
    CoordinatorOverrideService,
    StudentProfileService,
    TeacherProfileService,
    TeacherClassDutyService,
    CounselorClassAssignmentService,
  ],
})
export class ProfilesModule {}
