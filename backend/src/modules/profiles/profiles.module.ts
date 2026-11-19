import { Module, forwardRef } from '@nestjs/common'

import { AuditModule } from '../audit/audit.module.js'
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
import { MyClassesController } from './my-classes.controller.js'
import { MyClassesService } from './my-classes.service.js'
import { PersonnelProfileController } from './personnel-profile.controller.js'
import { PersonnelProfileService } from './personnel-profile.service.js'
import { StudentProfileController } from './student-profile.controller.js'
import { StudentProfileService } from './student-profile.service.js'
import { TeacherClassDutyController } from './teacher-class-duty.controller.js'
import { TeacherClassDutyService } from './teacher-class-duty.service.js'
import { TeacherProfileController } from './teacher-profile.controller.js'
import { TeacherProfileService } from './teacher-profile.service.js'

/**
 * 人员档案模块
 *
 * 学生档案、工作人员档案与教师档案共用本模块：
 * - 工作人员档案（PersonnelProfile）是教职工的统一身份，正式组织归属只有一个；
 * - 教师身份（TeacherProfile）挂在工作人员档案之下，所属组织从档案读取；
 * - 所有查询与写接口都按权限编码解析组织范围，不信任客户端传入的身份信息。
 */
@Module({
  imports: [
    AuthModule,
    OrganizationModule,
    AuditModule,
    forwardRef(() => MenusModule),
    forwardRef(() => AuthorizationModule),
  ],
  controllers: [
    CoordinatorController,
    StudentProfileController,
    PersonnelProfileController,
    TeacherProfileController,
    TeacherClassDutyController,
    CounselorClassAssignmentController,
    CoordinatorOverrideController,
    MyClassesController,
  ],
  providers: [
    CoordinatorActorPolicy,
    CoordinatorEligibilityService,
    CoordinatorLifecycleService,
    CoordinatorOverrideService,
    StudentProfileService,
    PersonnelProfileService,
    TeacherProfileService,
    TeacherClassDutyService,
    CounselorClassAssignmentService,
    MyClassesService,
  ],
  exports: [
    CoordinatorEligibilityService,
    CoordinatorLifecycleService,
    CoordinatorOverrideService,
    StudentProfileService,
    PersonnelProfileService,
    TeacherProfileService,
    TeacherClassDutyService,
    CounselorClassAssignmentService,
  ],
})
export class ProfilesModule {}
