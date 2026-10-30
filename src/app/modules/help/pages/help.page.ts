import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BaseComponent } from 'src/app/shared/base/base.component';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { BRAND } from 'src/app/config/brand.config';
import {
  AppSettingsService,
  pickLocalized,
} from 'src/app/core/services/app-settings.service';

@Component({
  selector: 'app-help-page',
  templateUrl: './help.page.html',
  styleUrls: ['./help.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [IonicModule, TranslateModule, RouterLink],
})
export class HelpPageComponent extends BaseComponent {
  readonly brand = BRAND;
  private readonly appSettings = inject(AppSettingsService);
  private readonly lang = toSignal(this.language$, {
    initialValue: this.currentLang,
  });

  /**
   * Dashboard-managed support details. Nothing is invented: a contact row is
   * shown only after it is configured in Admin > Settings > App content.
   */
  readonly support = computed(() => {
    const remote = this.appSettings.support();
    const lang = this.lang();
    const website = remote?.website ?? null;
    const email = remote?.email ?? null;
    const whatsapp = remote?.whatsapp ?? null;
    const links = (remote?.links ?? []).map((link) => ({
      url: link.url,
      label: pickLocalized(link.label, lang) ?? new URL(link.url).hostname,
    }));
    return {
      email,
      whatsapp,
      website,
      websiteLabel: website
        ? website.replace(/^https:\/\//, '').replace(/\/$/, '')
        : '',
      hasContact: !!(email || whatsapp || website || links.length),
      hours: pickLocalized(remote?.hours, lang),
      links,
    };
  });

  private static readonly BUILT_IN_FAQS = [
    { question: 'HELP_PAGE.FAQ_1_Q', answer: 'HELP_PAGE.FAQ_1_A' },
    { question: 'HELP_PAGE.FAQ_2_Q', answer: 'HELP_PAGE.FAQ_2_A' },
    { question: 'HELP_PAGE.FAQ_3_Q', answer: 'HELP_PAGE.FAQ_3_A' },
  ];

  /** Dashboard FAQ (plain text) when configured, otherwise translated built-ins. */
  readonly faqs = computed(() => {
    const remote = this.appSettings.faq();
    if (!remote?.length) {
      return HelpPageComponent.BUILT_IN_FAQS.map((f) => ({ ...f, translated: true }));
    }
    const lang = this.lang();
    return remote.map((f) => ({
      question: pickLocalized(f.question, lang) ?? '',
      answer: pickLocalized(f.answer, lang) ?? '',
      translated: false,
    }));
  });

  ionViewWillEnter(): void {
    void this.appSettings.refresh();
  }

  openEmail() {
    const email = this.support().email;
    if (email) window.location.href = `mailto:${email}`;
  }

  openWhatsApp() {
    const whatsapp = this.support().whatsapp;
    if (whatsapp) window.open(`https://wa.me/${whatsapp}`, '_blank', 'noopener');
  }

  openWebsite() {
    const website = this.support().website;
    if (website) window.open(website, '_blank', 'noopener');
  }

  openLink(url: string) {
    window.open(url, '_blank', 'noopener');
  }
}
