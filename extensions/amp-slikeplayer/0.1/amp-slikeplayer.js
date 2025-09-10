import {Deferred} from '#core/data-structures/promise';
import {dispatchCustomEvent} from '#core/dom';
import {isLayoutSizeDefined} from '#core/dom/layout';
import {observeIntersections} from '#core/dom/layout/viewport-observer';
import {once} from '#core/types/function';

import {Services} from '#service';
import {installVideoManagerForDoc} from '#service/video-manager-impl';

import {getData, listen} from '#utils/event-helper';
import {userAssert} from '#utils/log';

import {disableScrollingOnIframe} from '../../../src/iframe-helper';
import {
  addUnsafeAllowAutoplay,
  createFrameFor,
  isJsonOrObj,
  objOrParseJson,
} from '../../../src/iframe-video';
import {VideoEvents_Enum} from '../../../src/video-interface';

const TAG = 'amp-slikeplayer';

/**
 * @implements {../../../src/video-interface.VideoInterface}
 */

/**
 * @enum {string}
 * @private
 */

export class AmpSlikeplayer extends AMP.BaseElement {
  /** @param {!AmpElement} element */
  constructor(element) {
    super(element);

    /** @private {string} */
    this.apikey_ = '';

    /** @private {string} */
    this.videoid_ = '';

    /** @private {?HTMLIFrameElement} */
    this.iframe_ = null;

    /** @private {?function()} */
    this.unlistenFrame_ = null;

    /** @private {?Promise} */
    this.playerReadyPromise_ = null;

    /** @private {?function(Element)} */
    this.playerReadyResolver_ = null;

    /** @private {function(Object)} */
    this.onReadyOnce_ = once((detail) => this.onReady_(detail));

    /** @private {string} */
    this.config_ = '';

    /** @private {string} */
    this.poster_ = '';

    /** @private {string} */
    this.baseUrl_ = 'https://tvid.in/player/amp.html';

    /** @private {number} */
    this.duration_ = 1;

    /** @private {number} */
    this.currentTime_ = 0;

    /** @private {function()} */
    this.onMessage_ = this.onMessage_.bind(this);

    /** @private {?function()} */
    this.unlistenViewport_ = null;

    /** @private {number} 0..1 */
    this.viewportVisibleThreshold_ = 0;

    /** @private {string} */
    this.targetOrigin_ = '*';
  }

  /** @override */
  buildCallback() {
    const {element} = this;
    const deferred = new Deferred();

    this.playerReadyPromise_ = deferred.promise;
    this.playerReadyResolver_ = deferred.resolve;

    this.apikey_ = userAssert(
      element.getAttribute('data-apikey'),
      'The data-apikey attribute is required for <amp-slikeplayer> %s',
      element
    );

    this.videoid_ = userAssert(
      element.getAttribute('data-videoid'),
      'The data-videoid attribute is required for <amp-slikeplayer> %s',
      element
    );

    this.baseUrl_ = element.getAttribute('data-iframe-src') || this.baseUrl_;
    this.config_ = element.getAttribute('data-config') || '';
    this.poster_ = element.getAttribute('poster') || '';

    // Read optional viewport visibility threshold from data-config
    this.parseViewportThreshold_();

    installVideoManagerForDoc(element);
    const videoManager = Services.videoManagerForDoc(element);
    videoManager.register(this);
  }

  /** @override */
  createPlaceholderCallback() {
    if (!this.poster_) {
      return;
    }
    const placeholder = this.win.document.createElement('amp-img');
    const ariaLabel = this.element.getAttribute('aria-label');
    if (ariaLabel) {
      placeholder.setAttribute('aria-label', ariaLabel);
    }
    const src = this.poster_;
    placeholder.setAttribute('src', src);
    placeholder.setAttribute('layout', 'fill');
    placeholder.setAttribute('placeholder', '');
    placeholder.setAttribute('referrerpolicy', 'origin');
    if (placeholder.hasAttribute('aria-label')) {
      placeholder.setAttribute(
        'alt',
        'Loading video - ' + placeholder.getAttribute('aria-label')
      );
    } else {
      placeholder.setAttribute('alt', 'Loading video');
    }
    return placeholder;
  }

  /** @override */
  layoutCallback() {
    const src = this.buildIframeSrc_();

    const frame = disableScrollingOnIframe(
      createFrameFor(this, src, this.element.id)
    );

    addUnsafeAllowAutoplay(frame);
    this.unlistenFrame_ = listen(this.win, 'message', this.onMessage_);
    this.iframe_ = /** @type {HTMLIFrameElement} */ (frame);

    // Observe visibility to auto play/pause when entering/leaving viewport
    const threshold = this.viewportVisibleThreshold_;
    if (threshold > 0) {
      this.unlistenViewport_ = observeIntersections(
        this.element,
        (entry) => {
          const ratio =
            entry && typeof entry.intersectionRatio === 'number'
              ? entry.intersectionRatio
              : entry && entry.isIntersecting
                ? 1
                : 0;
          this.viewportCallback(ratio >= threshold);
        },
        {threshold}
      );
    }

    return this.loadPromise(this.iframe_);
  }

  /** @override */
  isLayoutSupported(layout) {
    return isLayoutSizeDefined(layout);
  }

  /** @override */
  supportsPlatform() {
    return true;
  }

  /** @override */
  isInteractive() {
    return true;
  }

  /** @override */
  viewportCallback(inViewport) {
    this.handleViewportPlayPause(inViewport);
  }

  /** @override */
  preimplementsAutoFullscreen() {
    return false;
  }

  /** @private */
  onReady_() {
    const {element} = this;
    this.playerReadyResolver_(this.iframe_);
    dispatchCustomEvent(element, VideoEvents_Enum.LOAD);
  }

  /**
   * @param {string} messageEvent
   * @private
   */
  onMessage_(messageEvent) {
    if (!this.isValidMessage_(messageEvent)) {
      return;
    }

    const messageData = getData(messageEvent);
    if (!isJsonOrObj(messageData)) {
      return;
    }

    const data = objOrParseJson(messageData);
    const event = data['event'];
    const detail = data['detail'];

    if (event === 'ready') {
      detail && this.onReadyOnce_(detail);
      return;
    }
    const {element} = this;
    this.handleEventDetail_(event, detail);
    dispatchCustomEvent(element, event, detail);
  }
  /**
   * @override
   */
  play() {
    this.postMessage_('play', '');
  }

  /**
   * @override
   */
  pause() {
    this.postMessage_('pause', '');
  }

  /**
   * Handle auto play/pause based on viewport visibility.
   *
   * @param {boolean} inViewport
   */
  handleViewportPlayPause(inViewport) {
    this.postMessage_('handleViewport', inViewport);
  }

  /**
   * @override
   */
  mute() {
    this.postMessage_('mute', '');
  }

  /**
   * @override
   */
  unmute() {
    this.postMessage_('unmute', '');
  }

  /** @override */
  preimplementsMediaSessionAPI() {
    return false;
  }

  /** @override */
  getMetadata() {
    //Not Implemented
  }

  /** @override */
  getCurrentTime() {
    return this.currentTime_;
  }

  /** @override */
  getDuration() {
    return this.duration_;
  }

  /** @override */
  getPlayedRanges() {
    return [];
  }

  /** @override */
  seekTo(unusedTimeSeconds) {
    this.postMessage_('seekTo', unusedTimeSeconds);
  }
  /**
   * @param {string} method
   * @param {*} [optParams]
   * @private
   */
  postMessage_(method, optParams) {
    this.playerReadyPromise_.then(() => {
      if (!this.iframe_ || !this.iframe_.contentWindow) {
        return;
      }
      this.iframe_.contentWindow./*OK*/ postMessage(
        JSON.stringify({
          'method': method,
          'optParams': optParams,
        }),
        this.targetOrigin_
      );
    });
  }

  /** @override */
  unlayoutCallback() {
    if (this.unlistenFrame_) {
      this.unlistenFrame_();
      this.unlistenFrame_ = null;
    }
    if (this.iframe_) {
      this.iframe_.src = 'about:blank';
      this.iframe_ = null;
    }
    if (this.unlistenViewport_) {
      this.unlistenViewport_();
      this.unlistenViewport_ = null;
    }
    return true;
  }

  /** @override */
  pauseCallback() {
    this.pause();
  }

  /**
   * @private
   * @return {string}
   */
  buildIframeSrc_() {
    this.setTargetOrigin_();

    const params = this.buildUrlParams_();
    return `${this.baseUrl_}#${params.join('&')}`;
  }

  /**
   * @private
   */
  setTargetOrigin_() {
    try {
      const url = new URL(this.baseUrl_);
      this.targetOrigin_ = url.origin;
    } catch {
      // Keep default target origin
    }
  }

  /**
   * @private
   * @return {!Array<string>}
   */
  buildUrlParams_() {
    const params = [
      `apikey=${encodeURIComponent(this.apikey_)}`,
      `videoid=${encodeURIComponent(this.videoid_)}`,
    ];

    const extra = this.normalizeConfig_();
    if (extra) {
      params.push(extra);
    }

    const origin = this.win.location?.origin;
    if (origin) {
      params.push(`baseurl=${encodeURIComponent(origin)}`);
    }

    return params;
  }

  /**
   * @private
   * @return {string}
   */
  normalizeConfig_() {
    return (this.config_ || '').trim().replace(/^[#?&]+/, '');
  }

  /**
   * @private
   */
  parseViewportThreshold_() {
    if (!this.config_) {
      return;
    }

    try {
      const params = new URLSearchParams(this.config_);
      if (!params.has('viewport')) {
        return;
      }

      let threshold = parseFloat(params.get('viewport'));
      if (!isFinite(threshold)) {
        return;
      }

      // Convert percentage to ratio if needed
      if (threshold > 1) {
        threshold = threshold / 100;
      }

      this.viewportVisibleThreshold_ = Math.max(0, Math.min(1, threshold));
    } catch {
      // Ignore parsing errors
    }
  }

  /**
   * @private
   * @param {*} messageEvent
   * @return {boolean}
   */
  isValidMessage_(messageEvent) {
    return !!(
      this.iframe_ &&
      messageEvent &&
      messageEvent.source === this.iframe_.contentWindow
    );
  }

  /**
   * @private
   * @param {string} event
   * @param {*} detail
   */
  handleEventDetail_(event, detail) {
    if (!detail || !event) {
      return;
    }

    switch (event) {
      case 'cplVideoTimeUpdate':
        this.currentTime_ = detail.currentTime || 0;
        break;
      case 'cplAdProgress':
        this.currentTime_ = detail.position || 0;
        break;
      default:
        break;
    }
  }
}

AMP.extension(TAG, '0.1', (AMP) => {
  AMP.registerElement(TAG, AmpSlikeplayer);
});
