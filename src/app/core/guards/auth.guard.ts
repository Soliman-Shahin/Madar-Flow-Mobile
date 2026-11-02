import { Injectable, inject } from '@angular/core';
import { CanActivateFn, CanLoad, CanMatchFn, Route, Router, UrlSegment, UrlTree, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from 'src/app/modules/auth/services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuardService implements CanLoad {
  private auth = inject(AuthService);
  private router = inject(Router);

  canActivate(route?: ActivatedRouteSnapshot, state?: RouterStateSnapshot): boolean | UrlTree {
    if (this.auth.isLoggedIn) {
      return true;
    }
    
    // Store the attempted URL for redirecting after login
    if (state?.url) {
      this.auth.redirectUrl = state.url;
    }
    
    // Redirect to login if not authenticated
    return this.router.parseUrl('/auth/login');
  }

  // Prevent lazy modules from loading when unauthenticated
  canLoad(route: Route, segments: UrlSegment[]): boolean | UrlTree {
    if (this.auth.isLoggedIn) {
      return true;
    }
    
    // Store the attempted URL for redirecting after login
    const url = `/${segments.map(s => s.path).join('/')}`;
    this.auth.redirectUrl = url;
    
    return this.router.parseUrl('/auth/login');
  }

  // Route matching guard for stand-alone route configurations
  canMatch(route: Route, segments: UrlSegment[]): boolean | UrlTree {
    if (this.auth.isLoggedIn) {
      return true;
    }
    
    // Store the attempted URL for redirecting after login
    const url = `/${segments.map(s => s.path).join('/')}`;
    this.auth.redirectUrl = url;
    
    return this.router.parseUrl('/auth/login');
  }
}

// Functional guard adapter (Angular 15+)
export const AuthGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
  return inject(AuthGuardService).canActivate(route, state);
};

/**
 * Sign-in and sign-up are for signed-out visitors. A signed-in user who lands
 * on them (back button, stale link) is sent home instead of seeing the form
 * with the app's tab bar underneath.
 */
export const GuestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isLoggedIn ? router.parseUrl('/home') : true;
};

export const AuthMatchGuard: CanMatchFn = (
  route: Route,
  segments: UrlSegment[]
) => {
  return inject(AuthGuardService).canMatch(route, segments);
};
