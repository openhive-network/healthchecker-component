import { HealthChecker, TScoredEndpoint, WaxHealthCheckerError, WaxHealthCheckerValidatorFailedError } from "@hiveio/wax/vite";

export interface ApiChecker <T = unknown> {
  title: string;
  method: any;
  params: any;
  validatorFunction: (data: T) => string | true;
}

export type ValidationErrorDetails = {
  status: "serverError" | "validation";
  checkName: string;
  providerName: string;
  message: string;
  paths: string[];
  params?: string | object;
}

export interface HealthCheckerFields {
  apiCheckers: ApiChecker[];
  scoredEndpoints: TScoredEndpoint[] | undefined;
  failedChecksByProvider: Map<string, ValidationErrorDetails[]>;
  nodeAddress: string | null;
  providers?: string[];
  isActive?: boolean;
  switchStatus?: "waiting" | "done" | "no_change";
}

const LOCAL_PROVIDERS = "localProviders";

class HealthCheckerService extends EventTarget {

  private defaultProviders?: string[];
  private healthChecker?: HealthChecker;
  private endpointTitleById: Map<number, string> = new Map();
  private enableLogs?: boolean;
  
  
  public scoredEndpoints?: TScoredEndpoint[];
  public failedChecksByProvider: Map<string, ValidationErrorDetails[]> = new Map();
  public nodeAddress: string | null = null;
  public providers?: string[];
  public apiCheckers?: ApiChecker[];
  public serviceKey?: string;
  public isActive?: boolean;
  public switchStatus?:  "waiting" | "done" | "no_change" = undefined;
  
  public changeNodeAddress: (node:string | null) => void = () => {}

  /**
   * 
   * @param serviceKey 
   * @param apiCheckers 
   * @param defaultProviders 
   * @param nodeAddress 
   * @param changeNodeAddress 
   * @param enableLogs 
   * Initialize necessery part of HC process. Set providers, chekers and addresses. Don't start checks yet.
   */
  constructor(
    serviceKey: string,
    apiCheckers: ApiChecker[],
    defaultProviders: string[],
    nodeAddress: string | null,
    changeNodeAddress: (node: string | null) => void,
    enableLogs?: boolean,
  ) {
    super();
    this.serviceKey = serviceKey;
    this.apiCheckers = apiCheckers;
    this.nodeAddress = nodeAddress;
    this.defaultProviders = defaultProviders;
    this.isActive = false;
    this.healthChecker = new HealthChecker();
    this.readLocalProvidersFromLocalStorage();
    this.changeNodeAddress = changeNodeAddress;
    this.initializeHealthChecker();
    this.enableLogs = enableLogs;
  }

  emit(eventName: string, detail?: HealthCheckerFields) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }


  // Local Storage

  readLocalProvidersFromLocalStorage = () => {
    try {
      const readValue = window.localStorage.getItem(`${LOCAL_PROVIDERS}-${this.serviceKey}`);
      if (readValue) { 
        this.providers = JSON.parse(readValue);
      } else {
        this.providers = this.defaultProviders;
      }
    } catch (error) {
      console.log(error);
    }
  }

  writeLocalProvidersToLocalStorage = async (localProviders: string[]) => {
    try {
      if (localProviders && localProviders.length > 0) {
        await window.localStorage.setItem(`${LOCAL_PROVIDERS}-${this.serviceKey}`, JSON.stringify(localProviders));
        this.providers = localProviders;
      } else {
        await window.localStorage.removeItem(`${LOCAL_PROVIDERS}-${this.serviceKey}`);
        this.providers = undefined;
      }
    } catch (error) {
      console.log(error);
    }
  }

  // HC Logic

  handleChangeOfNode = (nodeAddress: string | null) => {
    this.changeNodeAddress(nodeAddress);
    this.nodeAddress = nodeAddress;
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  handleHealthCheckerError = (error: WaxHealthCheckerError): void => {
    if (this.enableLogs) console.error(error);
    const endpointId = error.apiEndpoint.id;
    const provider = error.apiUrl || "";
    this.markValidationError(endpointId, provider, error, false)
  }

  markValidationError = (endpointId: number, providerName: string, error: WaxHealthCheckerValidatorFailedError<string> | WaxHealthCheckerError, isValidation: boolean = true) => {
    const checkTitle = this.endpointTitleById.get(endpointId);
    let params: string | object | undefined = undefined;
    if ("request" in error) params = error.request.data;
    if (checkTitle) {
      const checkObject: ValidationErrorDetails = {
        status: isValidation ? "validation" : "serverError",
        checkName: checkTitle,
        providerName: providerName,
        message: error.message,
        paths: error.apiEndpoint.paths,
        params: params
      }
      const prevoiusFailedChecks = [...this.failedChecksByProvider.get(providerName) || [], checkObject];
      const newFailedChecks = structuredClone(this.failedChecksByProvider).set(providerName, prevoiusFailedChecks);
      this.failedChecksByProvider = newFailedChecks;
      this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
    }
  } 

  clearValidationError = (providerName: string, checkName: string) => {
    const failedChecks = [...this.failedChecksByProvider.get(providerName) || []].filter((failedCheck) => failedCheck.checkName !== checkName);
    const newFailedChecks = structuredClone(this.failedChecksByProvider).set(providerName, failedChecks);
    this.failedChecksByProvider = newFailedChecks;
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  updateAppAfterScoredEndpointsChange = (data: Array<TScoredEndpoint>) => {
    if (this.enableLogs) console.log(JSON.stringify(data)); 
    if (data.length)this.scoredEndpoints = data;
    if (this.switchStatus) {
      this.switchToBestProvider();
    }
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  /**
   * Part of HC necessary initialization. Set event listeners and default endpoints.
   */
  initializeHealthChecker = async () => {
    this.healthChecker?.on('error', (error: WaxHealthCheckerError) => {this.handleHealthCheckerError(error)});
    this.healthChecker?.on("data", this.updateAppAfterScoredEndpointsChange);
    this.healthChecker?.on("validationerror", (error: WaxHealthCheckerValidatorFailedError) => this.markValidationError(error.apiEndpoint.id, error.request.endpoint, error));
    const initialEndpoints: TScoredEndpoint[] | undefined = this.providers?.map(
      (customProvider) => ({endpointUrl: customProvider, score: -1, up: true, latencies: []})
    )
    if (!!initialEndpoints && !this.scoredEndpoints) this.scoredEndpoints = initialEndpoints;
  }

  evaluateAndSwitch = () => {
    if (this.isActive && this.scoredEndpoints?.[0]?.up) {
      this.switchToBestProvider()
    } else {
      this.switchStatus = "waiting";
      this.registerCalls();
      this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
      this.stopCheckingProcess();
    }
  }

  switchToBestProvider = () => {
    const bestProvider = this.scoredEndpoints?.[0]
    if (bestProvider?.up && bestProvider?.endpointUrl) {
      if (this.nodeAddress !== bestProvider.endpointUrl) {
        this.handleChangeOfNode(bestProvider.endpointUrl);
        this.switchStatus = "done";
      setTimeout(() => {
        this.switchStatus = undefined;
        this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
      }, 5000);
      } 
      this.switchStatus = "no_change";
      this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
      setTimeout(() => {
        this.switchStatus = undefined;
        this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
      }, 5000);
    } 
  }


  registerCalls = async () => {
    const registeredEndpoints = new Map<number, string>();
    if (this.apiCheckers)
    for (const checker of this.apiCheckers) {
      const healthCheckerEndpoint = await this.healthChecker?.register(checker!.method, checker!.params, checker!.validatorFunction, this.providers);
      if (healthCheckerEndpoint)
      registeredEndpoints.set(healthCheckerEndpoint.id, checker.title);
    }
    this.endpointTitleById = registeredEndpoints;
  }

  /**
   * Trigger automatic checks.
   */
  startCheckingProcess = async () => {
    this.registerCalls();
    this.isActive = true;
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  /**
   * Stop automatic checks.
   */
  stopCheckingProcess = async () => {
    this.healthChecker?.unregisterAll();
    this.isActive = false;
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  addProvider = (provider: string) => {
    if (this.healthChecker) {
      for (const endpoint of this.healthChecker) {
        endpoint.addEndpointUrl(provider);
      }
      if (this.providers && !this.providers.some((localProvider) => provider === localProvider)) {
        this.writeLocalProvidersToLocalStorage([...(this.providers || []), provider]);
        this.providers = [...(this.providers || []), provider];
        this.scoredEndpoints = [...this.scoredEndpoints || [], {endpointUrl: provider, score: -1, up: true, latencies: []}]
        this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
      }
    }
  }

  removeProvider = (provider: string) => {
    if (this.healthChecker && this.providers)
    for (const endpoint of this.healthChecker) {
      endpoint.removeEndpointUrl(provider);
    }
    const newLocalProviders = this.providers?.filter((localProvider) => localProvider !== provider) || [];
    this.scoredEndpoints = this.scoredEndpoints?.filter((endpoint) => endpoint.endpointUrl !== provider);
    this.writeLocalProvidersToLocalStorage(newLocalProviders);
    this.providers = newLocalProviders;
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  resetProviders = () => {
    if (this.nodeAddress && !this?.defaultProviders?.includes(this.nodeAddress)) {
      this.writeLocalProvidersToLocalStorage([...this?.defaultProviders || [], this.nodeAddress] );
    } else {
      this.writeLocalProvidersToLocalStorage(this?.defaultProviders || []);
    }
    this.scoredEndpoints = [];
    this.healthChecker?.unregisterAll();
    this.registerCalls();
    this.emit(`stateChange-${this.serviceKey}`, this.getComponentData());
  }

  getComponentData = (): HealthCheckerFields | undefined => {
    if (this.apiCheckers && this.scoredEndpoints)
    return {
      apiCheckers: this.apiCheckers,
      scoredEndpoints: this.scoredEndpoints,
      failedChecksByProvider: this.failedChecksByProvider,
      nodeAddress: this.nodeAddress,
      providers: this.providers,
      isActive: this.isActive,
      switchStatus: this.switchStatus,
    }
  }

}

export {HealthCheckerService};