const SELECTOR_PREFIX = 'selector::';

const CONSOLE_STYLE = {
  DEFAULT: 'display: block; color: #fff; background: #130f40; text-decoration: underline; margin-right: 10px',
  DATA_ITEM: 'color: #f1c40f; background: #130f40; font-weight: 600',
  SELECTOR: 'color: #2ecc71; background: #130f40; font-weight: 600'
};

class DataStore {
  constructor() {
    this.store = {};

    this.listeners = {};
    this.selectors = {};
  }

  _initDataStoreItem(name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.store, name)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`%c[DATA STORE]初始化Data元素: %c${name}%c (初始值: %c${JSON.stringify(value, null, '  ')}%c)`, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT);
      }

      this.store[name] = {
        _data: value,
        _selectors: []
      };
      this.listeners[name] = [];
    }
  }

  /**
   * 初始化data store.
   * @param {object} initialObject 初始化对象.
   * 格式:
   * {
   *   data: {
   *     foo: 'initial_value',
   *     bar: 123
   *   },
   *   selectors: [ 'quz', 'baz' ]
   * }
   */
  initDataStore({ data = {}, selectors = [] }) {
    Object.entries(data).forEach(([ name, initialValue ]) => {
      this._initDataStoreItem(name, initialValue);
    });

    selectors.forEach((selectorName) => {
      if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
        selectorName = `${SELECTOR_PREFIX}${selectorName}`;
      }

      if (process.env.NODE_ENV === 'development') {
        console.log(`%c[DATA STORE]初始化selector: %c${selectorName}`, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR);
      }

      this.selectors[selectorName] = {
        _transformer: () => {},
        _deps: [],
        _listeners: []
      };
    });
  }

  /**
   * 使用Hook (React Hook)对状态进行管理、使用。
   * @param {React} react React实例。通常就是import进来的那个React。
   * @param {string[]} deps Data store中的Data或Selector项。
   * @returns {[state, func, func]}
   */
  bindStateHook(react, deps) {
    const self = this;
    const state = {};
    const listeners = [];

    (deps||[]).reduce((accum, dataStoreName) => {
      const [ stateInstace, updateStateInstance ] = react.useState(this.get(dataStoreName));

      accum[dataStoreName] = [
        stateInstace,
        (value) => {
          if (typeof value === 'function') {
            this.update(dataStoreName, value(this.get(dataStoreName)));
          } else {
            this.update(dataStoreName, value);
          }
        }
      ];

      const addListenerMethod = dataStoreName.indexOf(SELECTOR_PREFIX) === 0 ? 'addSelectorListener' : 'addDataListener';
      listeners.push({
        listener: null,
        onMount() {
          this.listener = self[addListenerMethod](dataStoreName, (data) => {
            updateStateInstance(data);
          }, true);
        },
        onUnmount() {
          if (this.listener) {
            this.listener.remove();
          }
        }
      });

      return accum;
    }, state);

    return [
      {...state},
      /**
       * Initiate hook in Effect.
       */
      () => {
        listeners.forEach((listener) => {
          listener.onMount();
        });
      },
      /**
       * Clear listeners in Effect.
       */
      () => {
        listeners.forEach((listener) => {
          listener.onUnmount();
        });
      }
    ];

  }

  /**
   * 将data store中的data及selector绑定到component的state上。
   * @param {class} component 需要绑定的组件
   * @param {object} mapping state映射。
   * @returns {object} 生成的state对象，用以插入到component的state中。
   * 例如:
   * {
   *    'foo': 'state_in_component',
   *    'selector::bar': ['state_a', 'state_b']
   * }
   */
  bindState(component, mapping) {
    const self = this;
    const state = {};
    const listeners = [];

    Object.entries(mapping).reduce((accum, [ dataStoreName, targetNames ]) => {
      if (!Array.isArray(targetNames)) {
        targetNames = [targetNames];
      }

      targetNames.forEach((targetName) => {
        accum[targetName] = this.get(dataStoreName);
      });

      const addListenerMethod = dataStoreName.indexOf(SELECTOR_PREFIX) === 0 ? 'addSelectorListener' : 'addDataListener';
      listeners.push({
        listener: null,
        onMount() {
          this.listener = self[addListenerMethod](dataStoreName, (data) => {
            const state = targetNames.reduce((stateAccum, targetName) => {
              stateAccum[targetName] = data;
              return stateAccum;
            }, {});

            component.setState(state);
          }, true);
        },
        onUnmount() {
          if (this.listener) {
            this.listener.remove();
          }
        }
      });

      return accum;
    }, state);

    return {
      state,
      didMount() {
        listeners.forEach((listener) => {
          listener.onMount();
        });
      },
      willUnmount() {
        listeners.forEach((listener) => {
          listener.onUnmount();
        });
      }
    };
  }

  _compareValuesDiff(a, b) {
    const notFunction = (o) => typeof o !== 'function';
    const bothValueNotFunction = (a, b) => notFunction(a) && notFunction(b);

    const isObject = (obj) => Object.prototype.toString.call(obj) === '[object Object]';
    const nonOnbjectValueEquals = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isShallowDiff = (a, b) => {
      if (Object.keys(a).length !== Object.keys(b).length) {
        return true;
      }

      for (let key in a) {
        if (a.hasOwnProperty(key)) {
          const valueA = a[key];
          const valueB = b[key];

          if (bothValueNotFunction(valueA, valueB) && (!isObject(valueA) && !isObject(valueB))) {
            return !nonOnbjectValueEquals(valueA, valueB);
          }

          return true;
        }
      }
      return false;
    };

    const compareStrategies = [
      {
        compareCase: (a, b) => {
          return isObject(a) && isObject(b);
        },
        compareStrategy: (a, b) => {
          return isShallowDiff(a, b);
        }
      },
      {
        compareCase: (a, b) => {
          return typeof a !== typeof b;
        },
        compareStrategy: () => {
          return true;
        }
      },
      {
        compareCase: (a, b) => {
          return typeof a === 'function' && typeof b === 'function';
        },
        compareStrategy: () => {
          return true;
        }
      },
      {
        compareCase: () => {
          return true;
        },
        compareStrategy: (a, b) => {
          return JSON.stringify(a) !== JSON.stringify(b);
        }
      }
    ];

    let compareHandler = null;
    compareStrategies.some(({ compareCase, compareStrategy }) => {
      const matchCase = compareCase(a, b);
      if (matchCase) {
        compareHandler = compareStrategy;
      }
      return matchCase;
    });

    return compareHandler(a, b);
  }

  update(name, data) {
    this._initDataStoreItem(name);

    const prevData = this.store[name]._data;
    const depSelectors = this.store[name]._selectors;

    if (!this._compareValuesDiff(data, prevData)) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`%c[DATA STORE]Data元素无变化，无需更新: %c${name}
      %cDEP-SELECTORS: %c${depSelectors.join(', ')}
      %cCURRENT: %c${JSON.stringify(data, null, '  ')}
      %cPREV: %c${JSON.stringify(prevData, null, '  ')}
      `, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM);
      }
      return;
    }

    this.store[name]._data = data;

    if (process.env.NODE_ENV === 'development') {
      console.log(`%c[DATA STORE]更新Data元素: %c${name}
    %cDEP-SELECTORS: %c${depSelectors.join(', ')}
    %cCURRENT==>: %c${JSON.stringify(data, null, '  ')}
    %c<==PREV: %c${JSON.stringify(prevData, null, '  ')}
    `, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.DATA_ITEM);
    }

    // 遍历data listener...
    this.listeners[name].forEach(({ onChange }) => {
      onChange(data, prevData);
    });
    // 遍历selector listener...
    depSelectors.forEach((selectorName) => {
      const { _listeners: selectorListeners } = this.selectors[selectorName];

      selectorListeners.forEach(({ onChange }) => {
        onChange(this.getSelector(selectorName));
      });
    });

    return this;
  }

  getSelector(name) {
    if (!this.selectors.hasOwnProperty(name)) throw new Error(`尚未定义selector: ${name}`);

    const { _transformer, _deps } = this.selectors[name];
    const depData = _deps.map((dep) => this.store[dep]._data);
    const selectorValue = _transformer(...depData);

    if (process.env.NODE_ENV === 'development') {
      console.log(`%c[DATA STORE]计算selector: %c${name}
    %cDeps: %c${_deps.join(', ')}
    %cValue: %c${JSON.stringify(selectorValue, null, '  ')}
    `, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR, CONSOLE_STYLE.DEFAULT, CONSOLE_STYLE.SELECTOR);
    }

    return selectorValue;
  }

  get(name) {
    if (name.indexOf(SELECTOR_PREFIX) === 0) {
      return this.getSelector(name);
    } else {
      if (!Object.prototype.hasOwnProperty.call(this.store, name)) {
        throw new Error(`未被初始化的数据项目: ${ name }`);
      }
      return this.store[name]._data;
    }
  }

  defineSelector(selectorName, depNames, transformer) {
    if (typeof selectorName !== 'string') {
      throw new TypeError('未定义selector名称');
    }

    if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
      selectorName = `${SELECTOR_PREFIX}${selectorName}`;
    }

    if (!Array.isArray(depNames)) {
      depNames = [depNames];
    }

    depNames.forEach((dep) => {
      const storeItem = this.store[dep];
      if (storeItem._selectors.indexOf(selectorName) === -1) {
        storeItem._selectors.push(selectorName);
      }
    });

    this.selectors[selectorName] = {
      _transformer: transformer,
      _deps: depNames,
      _listeners: []
    };
  }

  addSelectorListener(selectorName, onChange, executeImmediately = false) {
    if (selectorName.indexOf(SELECTOR_PREFIX) !== 0) {
      selectorName = `${SELECTOR_PREFIX}${selectorName}`;
    }

    const self = this;

    const listener = {
      onChange,
      _removed: false,
      remove() {
        this._removed = true;

        self.selectors[selectorName]._listeners = [
          ...self.selectors[selectorName]._listeners.filter(({_removed}) => !_removed)
        ];
      }
    };

    this.selectors[selectorName]._listeners.push(listener);
    if (executeImmediately) {
      onChange(this.getSelector(selectorName));
    }

    return listener;
  }

  addDataListener(targetName, onChange, executeImmediately = false) {
    this._initDataStoreItem(targetName);

    const self = this;

    const listener = {
      onChange,
      _removed: false,
      remove() {
        this._removed = true;

        self.listeners[targetName] = [...self.listeners[targetName].filter(({_removed}) => !_removed)];
      }
    };

    this.listeners[targetName].push(listener);

    if (executeImmediately) {
      onChange(this.store[targetName]._data);
    }

    return listener;
  }
}

const store = new DataStore();

export const dataStore = {
  initDataStore: store.initDataStore.bind(store),
  bindState: store.bindState.bind(store),
  bindStateHook: store.bindStateHook.bind(store),
  update: store.update.bind(store),
  get: store.get.bind(store),
  getSelector: store.getSelector.bind(store),
  addDataListener: store.addDataListener.bind(store),
  addSelectorListener: store.addSelectorListener.bind(store),
  defineSelector: store.defineSelector.bind(store)
};
