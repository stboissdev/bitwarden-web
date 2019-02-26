import * as jq from 'jquery';
import * as _swal from 'sweetalert';
import { SweetAlert } from 'sweetalert/typings/core';

import {
    BodyOutputType,
    Toast,
    ToasterConfig,
    ToasterContainerComponent,
    ToasterService,
} from 'angular2-toaster';
import { Angulartics2 } from 'angulartics2';
import { Angulartics2GoogleAnalytics } from 'angulartics2/ga';

import {
    Component,
    NgZone,
    OnDestroy,
    OnInit,
    SecurityContext,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
    NavigationEnd,
    Router,
} from '@angular/router';

import { BroadcasterService } from 'jslib/angular/services/broadcaster.service';

import { StorageService } from 'jslib/abstractions/storage.service';

import { AuthService } from 'jslib/abstractions/auth.service';
import { CipherService } from 'jslib/abstractions/cipher.service';
import { CollectionService } from 'jslib/abstractions/collection.service';
import { CryptoService } from 'jslib/abstractions/crypto.service';
import { FolderService } from 'jslib/abstractions/folder.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { LockService } from 'jslib/abstractions/lock.service';
import { NotificationsService } from 'jslib/abstractions/notifications.service';
import { PasswordGenerationService } from 'jslib/abstractions/passwordGeneration.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { SearchService } from 'jslib/abstractions/search.service';
import { SettingsService } from 'jslib/abstractions/settings.service';
import { SyncService } from 'jslib/abstractions/sync.service';
import { TokenService } from 'jslib/abstractions/token.service';
import { UserService } from 'jslib/abstractions/user.service';

import { ConstantsService } from 'jslib/services/constants.service';

import { RouterService } from './services/router.service';

const BroadcasterSubscriptionId = 'AppComponent';
// Hack due to Angular 5.2 bug
const swal: SweetAlert = _swal as any;
const IdleTimeout = 60000 * 10; // 10 minutes

@Component({
    selector: 'app-root',
    templateUrl: 'app.component.html',
})
export class AppComponent implements OnDestroy, OnInit {
    toasterConfig: ToasterConfig = new ToasterConfig({
        showCloseButton: true,
        mouseoverTimerStop: true,
        animation: 'flyRight',
        limit: 5,
    });

    private lastActivity: number = null;
    private idleTimer: number = null;
    private isIdle = false;

    constructor(private angulartics2GoogleAnalytics: Angulartics2GoogleAnalytics,
        private broadcasterService: BroadcasterService, private userService: UserService,
        private tokenService: TokenService, private folderService: FolderService,
        private settingsService: SettingsService, private syncService: SyncService,
        private passwordGenerationService: PasswordGenerationService, private cipherService: CipherService,
        private authService: AuthService, private router: Router, private analytics: Angulartics2,
        private toasterService: ToasterService, private i18nService: I18nService,
        private platformUtilsService: PlatformUtilsService, private ngZone: NgZone,
        private lockService: LockService, private storageService: StorageService,
        private cryptoService: CryptoService, private collectionService: CollectionService,
        private sanitizer: DomSanitizer, private searchService: SearchService,
        private notificationsService: NotificationsService, private routerService: RouterService) { }

    ngOnInit() {
        this.ngZone.runOutsideAngular(() => {
            window.onmousemove = () => this.recordActivity();
            window.onmousedown = () => this.recordActivity();
            window.ontouchstart = () => this.recordActivity();
            window.onclick = () => this.recordActivity();
            window.onscroll = () => this.recordActivity();
            window.onkeypress = () => this.recordActivity();
        });

        this.broadcasterService.subscribe(BroadcasterSubscriptionId, async (message: any) => {
            this.ngZone.run(async () => {
                switch (message.command) {
                    case 'loggedIn':
                    case 'loggedOut':
                    case 'unlocked':
                        this.notificationsService.updateConnection(false);
                        break;
                    case 'logout':
                        this.logOut(!!message.expired);
                        break;
                    case 'lockVault':
                        await this.lockService.lock();
                        break;
                    case 'locked':
                        this.notificationsService.updateConnection(false);
                        this.router.navigate(['lock']);
                        break;
                    case 'lockedUrl':
                        window.setTimeout(() => this.routerService.setPreviousUrl(message.url), 500);
                        break;
                    case 'syncStarted':
                        break;
                    case 'syncCompleted':
                        break;
                    case 'upgradeOrganization':
                        const upgradeConfirmed = await this.platformUtilsService.showDialog(
                            this.i18nService.t('upgradeOrganizationDesc'), this.i18nService.t('upgradeOrganization'),
                            this.i18nService.t('upgradeOrganization'), this.i18nService.t('cancel'));
                        if (upgradeConfirmed) {
                            this.router.navigate(['organizations', message.organizationId, 'settings', 'billing']);
                        }
                        break;
                    case 'premiumRequired':
                        const premiumConfirmed = await this.platformUtilsService.showDialog(
                            this.i18nService.t('premiumRequiredDesc'), this.i18nService.t('premiumRequired'),
                            this.i18nService.t('learnMore'), this.i18nService.t('cancel'));
                        if (premiumConfirmed) {
                            this.router.navigate(['settings/premium']);
                        }
                        break;
                    case 'showToast':
                        this.showToast(message);
                        break;
                    case 'analyticsEventTrack':
                        this.analytics.eventTrack.next({
                            action: message.action,
                            properties: { label: message.label },
                        });
                        break;
                    default:
                        break;
                }
            });
        });

        this.router.events.subscribe((event) => {
            if (event instanceof NavigationEnd) {
                const modals = Array.from(document.querySelectorAll('.modal'));
                for (const modal of modals) {
                    (jq(modal) as any).modal('hide');
                }

                if (document.querySelector('.swal-modal') != null) {
                    swal.close(undefined);
                }
            }
        });
    }

    ngOnDestroy() {
        this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);
    }

    private async logOut(expired: boolean) {
        const userId = await this.userService.getUserId();

        await Promise.all([
            this.syncService.setLastSync(new Date(0)),
            this.tokenService.clearToken(),
            this.cryptoService.clearKeys(),
            this.userService.clear(),
            this.settingsService.clear(userId),
            this.cipherService.clear(userId),
            this.folderService.clear(userId),
            this.collectionService.clear(userId),
            this.passwordGenerationService.clear(),
        ]);

        this.searchService.clearIndex();
        this.authService.logOut(async () => {
            this.analytics.eventTrack.next({ action: 'Logged Out' });
            if (expired) {
                this.toasterService.popAsync('warning', this.i18nService.t('loggedOut'),
                    this.i18nService.t('loginExpired'));
            }
            this.router.navigate(['/']);
        });
    }

    private async recordActivity() {
        const now = (new Date()).getTime();
        if (this.lastActivity != null && now - this.lastActivity < 250) {
            return;
        }

        this.lastActivity = now;
        this.storageService.save(ConstantsService.lastActiveKey, now);

        // Idle states
        if (this.isIdle) {
            this.isIdle = false;
            this.idleStateChanged();
        }
        if (this.idleTimer != null) {
            window.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        this.idleTimer = window.setTimeout(() => {
            if (!this.isIdle) {
                this.isIdle = true;
                this.idleStateChanged();
            }
        }, IdleTimeout);
    }

    private showToast(msg: any) {
        const toast: Toast = {
            type: msg.type,
            title: msg.title,
        };
        if (typeof (msg.text) === 'string') {
            toast.body = msg.text;
        } else if (msg.text.length === 1) {
            toast.body = msg.text[0];
        } else {
            let message = '';
            msg.text.forEach((t: string) =>
                message += ('<p>' + this.sanitizer.sanitize(SecurityContext.HTML, t) + '</p>'));
            toast.body = message;
            toast.bodyOutputType = BodyOutputType.TrustedHtml;
        }
        if (msg.options != null) {
            if (msg.options.trustedHtml === true) {
                toast.bodyOutputType = BodyOutputType.TrustedHtml;
            }
            if (msg.options.timeout != null && msg.options.timeout > 0) {
                toast.timeout = msg.options.timeout;
            }
        }
        this.toasterService.popAsync(toast);
    }

    private idleStateChanged() {
        if (this.isIdle) {
            this.notificationsService.disconnectFromInactivity();
        } else {
            this.notificationsService.reconnectFromActivity();
        }
    }
}
