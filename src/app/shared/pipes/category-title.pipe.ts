import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Starter categories are stored with English titles ("Uncategorized",
 * "Income"). Show those in the app language; anything the user named
 * themselves is shown as typed.
 */
const DEFAULTS: Record<string, string> = {
  Uncategorized: 'DEFAULT_CATEGORIES.UNCATEGORIZED',
  Income: 'DEFAULT_CATEGORIES.INCOME',
};

export function categoryTitle(
  title: string | null | undefined,
  translate: TranslateService
): string {
  const text = title ?? '';
  const key = DEFAULTS[text];
  return key ? translate.instant(key) : text;
}

@Pipe({ name: 'categoryTitle', standalone: true, pure: false })
export class CategoryTitlePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(title: string | null | undefined): string {
    return categoryTitle(title, this.translate);
  }
}
