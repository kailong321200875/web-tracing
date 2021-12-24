// 请求拦截模块
import error from './err';
import performance from './performance';

class RequestTemplate {
  constructor(config = {}) {
    const list = ['src', 'method', 'duration', 'responseStatus'];
    list.forEach((key) => { this[key] = config[key] ?? null; });
  }
}

export default {
  init(options = {}) {
    this.options = options;
    this.interceptAjax();
    this.interceptFetch();
  },

  interceptAjax() {
    const { performance: tracePerformance } = this.options;
    const { open, send } = XMLHttpRequest.prototype;

    // 劫持 open方法
    XMLHttpRequest.prototype.open = function openXHR(method, url, async) {
      console.log('触发open');
      Object.defineProperty(this, '_config', {
        value: new RequestTemplate(),
        enumerable: false,
        configurable: false,
      });
      this._config.requestMethod = method;
      this._config.src = url;
      return open.call(this, method, url, async);
    };

    // 劫持 send方法
    XMLHttpRequest.prototype.send = function (body) {
      // body 就是post方法携带的参数

      // readyState发生改变时触发,也就是请求状态改变时
      // readyState 会依次变为 2,3,4 也就是会触发三次这里
      this.addEventListener('readystatechange', () => {
        console.log('this', this);
        const {
          readyState,
          status,
          responseURL = this._config.src,
          responseText,
        } = this;
        if (readyState === 4) { // 请求已完成,且响应已就绪
          if (status === 200 || status === 304) {
            if (tracePerformance && tracePerformance.server) {
              performance.tracePerformance('server', {
                src: responseURL,
                responseStatus: status,
                duration: Date.now() - this._config.triggerTime,
              });
            }
          } else {
            error.traceError('server', responseText, {
              src: responseURL,
              responseStatus: status,

              // 当服务器返回500状态码时才记录params,记录当前的接口参数（如果有）
              // 当body是FormData对象时,会被JSON.stringify方法序列化为"{}"。
              params: status === 500 && body ? body : undefined,
            });
          }
        }
      });

      this._config.triggerTime = Date.now();
      return send.call(this, body);
    };
  },

  interceptFetch() {
    const nativeFetch = window.fetch;
    if (nativeFetch) {
      window.fetch = function traceFetch(target, options = {}) {
        const fetchStart = Date.now();
        const { method = 'GET' } = options;
        const result = nativeFetch(target, options);
        result.then((res) => {
          const { url, status, statusText } = res;
          if (status === 200 || status === 304) {
            performance.tracePerformance('server', {
              src: url,
              duration: Date.now() - fetchStart,
              responseStatus: status,
            });
          } else {
            error.traceError('server', statusText, {
              src: url,
              responseStatus: status,

              // 只针对post请求和状态是500的情况收集传递的参数
              params: status === 500 && method.toUpperCase() === 'POST' ? options.body : undefined,
            });
          }
        }, (e) => {
          // 无法发起请求,连接失败
          error.traceError('server', e.message, { src: target });
        });
        return result;
      };
    }
  },
};