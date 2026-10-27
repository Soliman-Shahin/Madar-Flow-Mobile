import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BRAND_TRANSLATION_PARAMS } from 'src/app/config/brand.config';
@Component({
  standalone: true,
  imports: [IonicModule, TranslateModule],
  template: `<ion-header mode="ios" class="mf-sub-header" translucent="false">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button
            defaultHref="/auth/signup"
            [text]="''"
            [attr.aria-label]="'COMMON.BACK' | translate"
          ></ion-back-button>
        </ion-buttons>
        <ion-title>{{ titleKey | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="mf-doc">
      <article class="mf-doc__body">
        <header class="mf-doc__head">
          <h1>{{ titleKey | translate }}</h1>
          <p>{{ 'LEGAL.LAST_UPDATED' | translate }}</p>
        </header>
        @for (section of sections; track section.title) {
        <section class="mf-doc__section">
          <h2>{{ section.title | translate }}</h2>
          @for (paragraph of section.body; track paragraph) {
          <p>{{ paragraph | translate : brandParams }}</p>
          }
        </section>
        }
      </article>
    </ion-content>`,
  styles: [
    `
      ion-content.mf-doc {
        --background: var(--mf-bg);
        --color: var(--mf-ink);
      }
      .mf-doc__body {
        max-width: 68ch;
        margin-inline: auto;
        padding: var(--mf-space-5) var(--mf-gutter)
          calc(var(--mf-space-8) + var(--mf-tabbar-clearance));
        font-family: var(--mf-font-sans);
      }
      .mf-doc__head {
        padding-bottom: var(--mf-space-4);
        border-bottom: 1px solid var(--mf-separator);
      }
      .mf-doc__head h1 {
        margin: 0 0 var(--mf-space-1);
        font-size: var(--mf-text-title-1);
        font-weight: var(--mf-weight-bold);
        line-height: var(--mf-leading-tight);
        letter-spacing: -0.01em;
      }
      .mf-doc__head p {
        margin: 0;
        font-size: var(--mf-text-footnote);
        color: var(--mf-ink-3);
      }
      .mf-doc__section {
        padding-top: var(--mf-space-6);
      }
      .mf-doc__section h2 {
        margin: 0 0 var(--mf-space-2);
        font-size: var(--mf-text-headline);
        font-weight: var(--mf-weight-semibold);
        line-height: var(--mf-leading-snug);
      }
      .mf-doc__section p {
        margin: 0 0 var(--mf-space-3);
        font-size: var(--mf-text-body);
        line-height: 1.65;
        color: var(--mf-ink-2);
      }
    `,
  ],
})
export class LegalPageComponent {
  readonly brandParams = BRAND_TRANSLATION_PARAMS;
  titleKey = '';
  sections: { title: string; body: string[] }[] = [];
  constructor(route: ActivatedRoute) {
    const privacy = route.snapshot.routeConfig?.path === 'privacy';
    this.titleKey = privacy ? 'LEGAL.PRIVACY_TITLE' : 'LEGAL.TERMS_TITLE';
    this.sections = privacy
      ? [
          {
            title: 'LEGAL.PRIVACY_DATA_TITLE',
            body: ['LEGAL.PRIVACY_DATA_BODY', 'LEGAL.PRIVACY_ACCOUNT_BODY'],
          },
          {
            title: 'LEGAL.PRIVACY_STORAGE_TITLE',
            body: ['LEGAL.PRIVACY_STORAGE_BODY', 'LEGAL.PRIVACY_BACKUP_BODY'],
          },
          {
            title: 'LEGAL.PRIVACY_SERVICES_TITLE',
            body: [
              'LEGAL.PRIVACY_SERVICES_BODY',
              'LEGAL.PRIVACY_BIOMETRIC_BODY',
            ],
          },
          {
            title: 'LEGAL.PRIVACY_CONTROLS_TITLE',
            body: ['LEGAL.PRIVACY_CONTROLS_BODY', 'LEGAL.PRIVACY_CHANGES_BODY'],
          },
        ]
      : [
          {
            title: 'LEGAL.TERMS_SERVICE_TITLE',
            body: ['LEGAL.TERMS_SERVICE_BODY', 'LEGAL.TERMS_FINANCIAL_BODY'],
          },
          {
            title: 'LEGAL.TERMS_ACCOUNT_TITLE',
            body: ['LEGAL.TERMS_ACCOUNT_BODY', 'LEGAL.TERMS_SECURITY_BODY'],
          },
          {
            title: 'LEGAL.TERMS_OFFLINE_TITLE',
            body: ['LEGAL.TERMS_OFFLINE_BODY', 'LEGAL.TERMS_BACKUP_BODY'],
          },
          {
            title: 'LEGAL.TERMS_SERVICES_TITLE',
            body: ['LEGAL.TERMS_SERVICES_BODY', 'LEGAL.TERMS_CHANGES_BODY'],
          },
        ];
  }
}
