/**
 * Has Permission Directive
 *
 * Structural directive that shows/hides elements based on user permissions.
 * Uses Signals for reactive updates.
 */

import {
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  OnInit,
  inject,
  effect,
} from '@angular/core';
import { PermissionService } from '../../core/services/permission.service';
import { Permission } from '../models/plan.model';

@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnInit {
  @Input() appHasPermission!: Permission | Permission[];
  @Input() appHasPermissionMode: 'all' | 'any' = 'all';

  private permissionService = inject(PermissionService);
  private templateRef = inject(TemplateRef<any>);
  private viewContainer = inject(ViewContainerRef);
  private hasView = false;

  constructor() {
    // Use effect to react to permission changes
    effect(() => {
      // Access permissions signal to trigger effect
      this.permissionService.permissions();
      this.updateView();
    });
  }

  ngOnInit(): void {
    this.updateView();
  }

  private updateView(): void {
    const hasPermission = this.checkPermission();

    if (hasPermission && !this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    } else if (!hasPermission && this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }

  private checkPermission(): boolean {
    if (Array.isArray(this.appHasPermission)) {
      return this.appHasPermissionMode === 'all'
        ? this.permissionService.hasAllPermissions(this.appHasPermission)
        : this.permissionService.hasAnyPermission(this.appHasPermission);
    }
    return this.permissionService.hasPermission(this.appHasPermission);
  }
}
