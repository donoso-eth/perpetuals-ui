import { useEffect, useState } from "react";
import {
  Status,
  State,
  DedicatedMsgSender,
  Chain,
  TaskState,
  Message,
} from "../../types/Status";
import { BiRefresh, BiCopy } from "react-icons/bi";
import { firstValueFrom, interval, pipe, Subject, take, takeUntil } from "rxjs";
import { Contract, Wallet, ethers } from "ethers";
import { BrowserProvider } from "ethers6";
import metamask from "../../assets/images/metamask.png";
import Header from "../Header";
import Switch from "react-switch";
import { Tab, Tabs, TabList, TabPanel } from "react-tabs";
import "react-tabs/style/react-tabs.css";
import "./style.css";

import Loading from "../Loading";
import Button from "../Button";
import { LocalStorage } from "../../session/storage/local-storage";
import { StorageKeys } from "../../session/storage/storage-keys";

import { v4 as uuidv4 } from "uuid";

import { sessionKeyAbi } from "../../assets/contracts/sessionAbi";
import { CallWithERC2771Request, GelatoRelay } from "@gelatonetwork/relay-sdk";

import { TempKey } from "../../session/TempKey";

import { counterAbi } from "../../assets/contracts/counterAbi";
import {} from "ethers";
import Signless from "../Signless";
import { EvmPriceServiceConnection, PriceFeed } from "@pythnetwork/pyth-evm-js";
import { perpMockAbi } from "../../assets/contracts/perpMockAbi";
import Action from "../Action";

export interface IORDER {
  orderId: number;
  timestamp: number;
  amount: number;
  price: number;
  publishTime?: number;
  above?: boolean;
  leverage?: number;
  priceSettled?: number;
  threshold?: number | null;
  tokens?: number;
  active?: boolean;
}

const App = () => {
  const GELATO_RELAY_API_KEY = "API KEY"
  let destroyFetchTask: Subject<void> = new Subject();
  let txHash: string | undefined;
  const relay = new GelatoRelay();

  const localStorage = new LocalStorage();

  const [sessionKeyContract, setSessionKeyContract] = useState<Contract>();
  const [counterContract, setCounterContract] = useState<Contract>();
  const [perpMockContract, setPerpMockContract] = useState<Contract>();

  const [ready, setReady] = useState(false);
  const [price, setPrice] = useState(0);

  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<Message>({
    header: "Loading",
    body: undefined,
    taskId: undefined,
  });

  const [orders, setOrders] = useState<Array<IORDER>>([]);
  const [conditionalOrders, setConditionalOrders] = useState<Array<IORDER>>([]);
  const [marginOrder, setMarginOrder] = useState<IORDER | null>(null);

  const [priceConditional, setPriceConditional] = useState<number>(0);

  const [leverage, setLeverage] = useState<number>(0);
  const [addCollateral, setAddCollateral] = useState<number>(0);
  const [removeCollateral, setRemoveCollateral] = useState<number>(0);

  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [signLess, setGassless] = useState<boolean>(false);
  const [tabIndex, setTabIndex] = useState(0);

  const [connectStatus, setConnectStatus] = useState<Status | null>({
    state: State.missing,
    message: "Loading",
  });

  if (typeof window.ethereum != "undefined") {
    window.ethereum.on("accountsChanged", () => {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
    });

    window.ethereum.on("chainChanged", async () => {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      // if (currentChainId !== "0x75B3DCF") {
      //   await window.ethereum.request({
      //     method: "wallet_switchEthereumChain",
      //     params: [{ chainId: "0x75B3DCF" }],
      //   });
      // }
    });
  }

  const onDisconnect = async () => {
    setConnectStatus({
      state: State.failed,
      message: "Waiting for Disconnection",
    });
    localStorage.remove(StorageKeys.SESSION_ID);
    localStorage.remove(StorageKeys.SESSION_KEY);
    await window.ethereum.request({
      method: "eth_requestAccounts",
      params: [
        {
          eth_accounts: {},
        },
      ],
    });
  };

  const onConnect = async () => {
    console.log("connec");
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [
          {
            eth_accounts: {},
          },
        ],
      });
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
    } catch (error) {}
  };

  const onCopy = async (text: string) => {
    if ("clipboard" in navigator) {
      await navigator.clipboard.writeText(text);
    } else {
      document.execCommand("copy", true, text);
    }
    alert("Copied to Clipboard");
  };

  const onAction = async (action: number) => {
    switch (action) {
      case 0:
        if (signLess) {
          setOrderGassless();
        } else {
          setOrder();
        }

        break;
      case 1:
        if (signLess) {
          setConditionalOrderGassless();
        } else {
          setConditonalOrder();
        }

        break;
      case 2:
        executeMarginOrder();
        break;
      case 3:
        updateCollateralAmount(true);
        break;
      case 4:
        updateCollateralAmount(false);

        break;
      default:
        setLoading(false);
        break;
    }
  };

  const onUpdate = async (value: number, action: number) => {
    switch (action) {
      case 0:
        break;
      case 1:
        setPriceConditional(value);
        break;
      case 2:
        setLeverage(value);
        break;
      case 3:
        setAddCollateral(value);
        break;
      case 4:
        setRemoveCollateral(value);
        break;
      default:
        console.log("do nothing");
        break;
    }
  };

  const getPrice = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    if (price != 0) {
      return;
    }

    const connection = new EvmPriceServiceConnection(
      "https://hermes.pyth.network"
    ); // See Price Service endpoints section below for other endpoints

    const numbers = interval(2000);

    const takeFourNumbers = numbers.pipe(takeUntil(destroyFetchTask));

    takeFourNumbers.subscribe(async (x) => {
      try {
        const check = (await connection.getLatestPriceFeeds([
          "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        ])) as PriceFeed[];

        const priceObject = check[0].toJson().price;

        if (
          check.length !== 0 &&
          priceObject !== undefined &&
          priceObject.price !== undefined
        ) {
          setPrice(+priceObject.price.toString() / 10 ** 8);

          if (tabIndex == 2) {
            readMarginOrder(
              provider!,
              signerAddress!,
              +priceObject.price.toString() / 10 ** 8
            );
          }
        }
      } catch (error) {}
    });
  };
  //  static componentWillUnmount() {
  //     alert("The component named Header is about to be unmounted.");
  //   }

  const setOrder = async () => {
    try {
      setMessage({
        header: "Waiting for tx...",
        body: undefined,
        taskId: undefined,
      });
      console.log(278)
      try {
        setLoading(true);

        let perpMockContract = await getPerpMockContract(provider!);
       await perpMockContract?.setOrder(2000n);
        setTimeout(() => {
           doRefresh();
         }, 1000);
      } catch (error) {
        console.log(error)
      }
   
      //await tx.wait();
 
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };

  const setConditonalOrder = async () => {
    if (priceConditional == price) {
      alert("Prices can not be equeal");
      return;
    }

    try {
      setMessage({
        header: "Waiting for tx...",
        body: undefined,
        taskId: undefined,
      });
      setLoading(true);

      let above = true;
      if (priceConditional < price) {
        above = false;
      }
      let perpMockContract = await getPerpMockContract(provider!);
      let tx = await perpMockContract?.setConditionalOrder(
        20000,
        Math.floor(priceConditional * 10 ** 8),
        above
      );
      await tx.wait();
      setTimeout(() => {
        doRefresh();
      }, 2000);
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };

  const executeMarginOrder = async () => {
    if (leverage <= 0) {
      alert("leverage must be greater than 0");
      return;
    }

    if (price <= 0) {
      alert("Current price not available");
      return;
    }

    if (!signLess) {
      try {
        setMessage({
          header: "Waiting for tx...",
          body: undefined,
          taskId: undefined,
        });
        setLoading(true);

        let perpMockContract = await getPerpMockContract(provider!);
        let tx = await perpMockContract?.marginTrade(
          leverage,
          20000,
          Math.floor(price * 10 ** 8)
        );
        await tx.wait();
        setTimeout(() => {
          doRefresh();
        }, 2000);
      } catch (error) {
        console.log(error);
        setLoading(false);
      }
    } else {
      setMarginTradeGassless();
    }
  };

  const updateCollateralAmount = async (add: boolean) => {
    if (addCollateral <= 0 && add) {
      alert("Amount must be greater than 0");
      return;
    }

    if (removeCollateral <= 0 && !add) {
      alert("Amount must be greater than 0");
      return;
    }

    if (!signLess) {
      try {
        setMessage({
          header: "Waiting for tx...",
          body: undefined,
          taskId: undefined,
        });
        setLoading(true);

        let perpMockContract = await getPerpMockContract(provider!);
        let tx = await perpMockContract?.updateCollateral(
          marginOrder?.orderId,
          add ? addCollateral : removeCollateral,
          add
        );
        await tx.wait();
        setTimeout(() => {
          doRefresh();
        }, 2000);
      } catch (error) {
        console.log(error);
        setLoading(false);
      }
    } else {
      updateCollateralSignless(add);
    }
  };

  const setOrderGassless = async () => {
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);

    let perpMockContract = await getPerpMockContract(provider!);
    //
    const { data: dataSetOrder } =
      await perpMockContract!.setOrder.populateTransaction(20000);

    const request: CallWithERC2771Request = {
      chainId: BigInt(30),
      target: await perpMockContract?.getAddress()!,
      data: dataSetOrder as string,
      user: signerAddress as string,
    };

    const web3Provider = new BrowserProvider(window.ethereum);
    const response = await relay.sponsoredCallERC2771(
      request,
      web3Provider!,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  const setConditionalOrderGassless = async () => {
    if (priceConditional == price) {
      alert("Prices can not be equeal");
      return;
    }
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);
    let above = true;
    if (priceConditional < price) {
      above = false;
    }

    let perpMockContract = await getPerpMockContract(provider!);

    const { data: dataSetOrder } =
      await perpMockContract!.setConditionalOrder.populateTransaction(
        20000,
        Math.floor(priceConditional * 10 ** 8),
        above
      );

    const request: CallWithERC2771Request = {
      chainId: BigInt(30),
      target: await perpMockContract?.getAddress()!,
      data: dataSetOrder as string,
      user: signerAddress as string,
    };
    const web3Provider = new BrowserProvider(window.ethereum);
    const response = await relay.sponsoredCallERC2771(
      request,
      web3Provider!,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  const setMarginTradeGassless = async () => {
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);
    let above = true;
    if (priceConditional < price) {
      above = false;
    }

    let perpMockContract = await getPerpMockContract(provider!);

    const { data: dataSetOrder } =
      await perpMockContract!.marginTrade.populateTransaction(
        leverage,
        20000,
        Math.floor(price * 10 ** 8)
      );

    const request: CallWithERC2771Request = {
      chainId: BigInt(30),
      target: await perpMockContract?.getAddress()!,
      data: dataSetOrder as string,
      user: signerAddress as string,
    };
    const web3Provider = new BrowserProvider(window.ethereum);
    const response = await relay.sponsoredCallERC2771(
      request,
     web3Provider!,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  const updateCollateralSignless = async (add: boolean) => {
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);
    let above = true;
    if (priceConditional < price) {
      above = false;
    }

    let perpMockContract = await getPerpMockContract(provider!);

    const { data: dataSetOrder } =
      await perpMockContract!.updateCollateral.populateTransaction(
        marginOrder?.orderId,
        add ? addCollateral : removeCollateral,
        add
      );

    const request: CallWithERC2771Request = {
      chainId: BigInt(30),
      target: await perpMockContract?.getAddress()!,
      data: dataSetOrder as string,
      user: signerAddress as string,
    };
    const web3Provider = new BrowserProvider(window.ethereum);
    const response = await relay.sponsoredCallERC2771(
      request,
     web3Provider!,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  //// Tak Status per TaskId I
  const fetchStatus = async (taskIdToQuery: string) => {
    const numbers = interval(5000);

    const takeFourNumbers = numbers.pipe(takeUntil(destroyFetchTask));

    takeFourNumbers.subscribe(async (x) => {
      try {
        let status = await relay.getTaskStatus(taskIdToQuery);

        let details = {
          txHash: status?.transactionHash || undefined,
          chainId: status?.chainId?.toString() || undefined,
          blockNumber: status?.blockNumber?.toString() || undefined,
          executionDate: status?.executionDate || undefined,
          creationnDate: status?.creationDate || undefined,
          taskState: (status?.taskState as TaskState) || undefined,
        };
        let body = ``;
        let header = ``;

        txHash = details.txHash;

        switch (details.taskState!) {
          case TaskState.WaitingForConfirmation:
            header = `Transaction Relayed`;
            body = `Waiting for Confirmation`;
            break;
          case TaskState.Pending:
            header = `Transaction Relayed`;
            body = `Pending Status`;

            break;
          case TaskState.CheckPending:
            header = `Transaction Relayed`;
            body = `Simulating Transaction`;

            break;
          case TaskState.ExecPending:
            header = `Transaction Relayed`;
            body = `Pending Execution`;
            break;
          case TaskState.ExecSuccess:
            header = `Transaction Executed`;
            body = `Waiting to refresh...`;

            // await this.getTokenId();

            //this.store.dispatch(Web3Actions.chainBusy({ status: false }));

            destroyFetchTask.next();
            setTimeout(() => {
              doRefresh();
            }, 2000);

            break;
          case TaskState.Cancelled:
            header = `Canceled`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.ExecReverted:
            header = `Reverted`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.NotFound:
            header = `Not Found`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          case TaskState.Blacklisted:
            header = `BlackListed`;
            body = `TxHash: ${details.txHash}`;
            destroyFetchTask.next();
            break;
          default:
            // ExecSuccess = "ExecSuccess",
            // ExecReverted = "ExecReverted",
            // Blacklisted = "Blacklisted",
            // Cancelled = "Cancelled",
            // NotFound = "NotFound",
            // destroyFetchTask.next();
            break;
        }

        setMessage({
          header,
          body,
          taskId: txHash,
        });

        // this.store.dispatch(
        //   Web3Actions.chainBusyWithMessage({
        //     message: {
        //       body: body,
        //       header: header,
        //     },
        //   })
        // );
      } catch (error) {}
    });
  };

  //
  const changeTab = (index: number) => {
    setTabIndex(index);

    refreshTab(index);
  };

  const doRefresh = async () => {
    setMessage({
      header: "Refreshing Balance....",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);
    await refresh(provider!);
  };

  const readOrders = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    let perpMockContract = await getPerpMockContract(provider);

    let totalOrders = await perpMockContract.nrOrdersByUser(signerAddress);

    const _orders = [];
    for (let i = 0; i < +totalOrders.toString(); i++) {
      let orderId = await perpMockContract.ordersByUser.staticCallResult(
        signerAddress,
        i
      );

      let orderResult = await perpMockContract.getOrder(+orderId.toString());

      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        publishTime: +orderResult["publishTime"].toString(),
        amount: +orderResult["amount"].toString(),
        priceSettled: +orderResult["priceSettled"].toString() / 10 ** 8,
        price: 0,
      };

      _orders.push(order);
    }

    setOrders(_orders);
  };

  const readConditionalOrders = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    let perpMockContract = await getPerpMockContract(provider);

    let totalOrders = await perpMockContract.nrConditionalOrdersByUser(
      signerAddress
    );

    const _orders = [];
    for (let i = 0; i < +totalOrders.toString(); i++) {
      let orderId =
        await perpMockContract.conditionalOrdersByUser.staticCallResult(
          signerAddress,
          i
        );

      let orderResult = await perpMockContract.getConditionalOrder(
        +orderId.toString()
      );

      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        publishTime: +orderResult["publishTime"].toString(),
        amount: +orderResult["amount"].toString(),
        price: +orderResult["price"].toString() / 10 ** 8,
        priceSettled: +orderResult["priceSettled"].toString() / 10 ** 8,
        above: orderResult["above"],
      };

      _orders.push(order);
    }

    setConditionalOrders(_orders);
  };

  const readMarginOrder = async (
    provider: ethers.BrowserProvider,
    signerAddress: string,
    _price?: number
  ) => {
    if (_price == undefined) {
      _price = price;
    }

    let perpMockContract = await getPerpMockContract(provider);

    let orderId = await perpMockContract.marginTradeIdByUser.staticCallResult(
      signerAddress
    );

    if (+orderId.toString() > 0) {
      let orderResult = await perpMockContract.getMarginTrade(
        +orderId.toString()
      );

      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        leverage: +orderResult["leverage"].toString(),
        amount: +orderResult["amount"].toString(),
        price: +orderResult["price"].toString() / 10 ** 8,
        tokens: +orderResult["tokens"].toString() / 10 ** 4,
        active: orderResult["active"],
      };

      order.threshold = calculateThreshold(order, _price);

      setMarginOrder(order);
    }
  };

  const calculateThreshold = (order: IORDER, price: number): number | null => {
    if (order.price == 0) {
      return null;
    }

    let deviation = order.price - price;

    let threshold =
      ((order.amount - order.leverage! * deviation * order.tokens!) /
        (order.tokens! * order.price)) *
      100;

    return threshold;
  };

  const refreshTab = async (index: number) => {
    switch (index) {
      case 0:
        await readOrders(provider!, signerAddress!);
        break;
      case 1:
        await readConditionalOrders(provider!, signerAddress!);
        break;
      case 2:
        await readMarginOrder(provider!, signerAddress!);
        break;
      default:
        break;
    }
  };

  const refresh = async (provider: ethers.BrowserProvider) => {
    setProvider(provider);

    const addresses = await provider.listAccounts();

    if (addresses.length > 0) {
      const signer = await provider?.getSigner();
      const signerAddress = (await signer?.getAddress()) as string;
      setSignerAddress(signerAddress);
      setSigner(signer);
      setConnectStatus({
        state: State.success,
        message: "Connection Succeed",
      });
      getPrice(provider, signerAddress);
      if (tabIndex == 0) {
        readOrders(provider, signerAddress);
      } else if (tabIndex == 1) {
        readConditionalOrders(provider, signerAddress);
      } else if (tabIndex == 2) {
        readMarginOrder(provider, signerAddress);
      }
      setLoading(false);
    } else {
      setLoading(false);
      setConnectStatus({ state: State.failed, message: "Connection Failed" });
    }
  };


  const getPerpMockContract = async (provider: ethers.BrowserProvider) => {
    if (perpMockContract == undefined) {
      const signer = await provider?.getSigner();
      const perpMockAddress = "0x2BF28B8675E4eE0cD45Bd4150DbaA906CF72c935"//"0x0542F269C737bDe9e2d1883FaF0eC2F3D51e5B95";
      const _perpMock = new ethers.Contract(
        perpMockAddress,
        perpMockAbi,
        signer
      );

      setPerpMockContract(counterContract);
      return _perpMock;
    } else {
      return perpMockContract;
    }
  };


  const signToggle = async () => {
    setGassless(!signLess);
  };

  useEffect(() => {
    (async () => {
      if (provider != null) {
        return;
      }
      if (window.ethereum == undefined) {
        setLoading(false);
      } else {
        const currentChainId = await window.ethereum.request({
          method: "eth_chainId",
        });

        // if (currentChainId !== "0x75B3DCF") {
        //   await window.ethereum.request({
        //     method: "wallet_switchEthereumChain",
        //     params: [{ chainId: "0x75B3DCF" }],
        //   });
        // }
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        setProvider(web3Provider);
      }
    })();
  }, []);

  useEffect(() => {
    const init = async () => {
      if (!provider) {
        return;
      }
      const signer = provider.getSigner();

      /// Instantiate the contract
      const perpContract = await getPerpMockContract(provider);
      console.log(await perpMockContract?.getAddress())
      /// UI update when mint event is fired (we check if the minted token is ours)
      perpContract.on("settleOrderEvent", async (user: any, orderId) => {
        console.log(user, orderId);
        refresh(provider);
      });

      /// UI update when metadata update event is  fired (we check if the minted token is ours)
      refresh(provider);
    };
    init();
  }, [provider]);

  return (
    <div className="App">
      <div className="container">
        <Header
          status={connectStatus}
          ready={ready}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          signerAddress={signerAddress}
        />
        {connectStatus?.state! == State.success && (
          <div>
            {loading && <Loading message={message} />}
            <main>
              {price.toFixed(4)} BTC/USD
              <Tabs
                style={{ margin: "20px" }}
                defaultIndex={0}
                onSelect={(index) => changeTab(index)}
              >
                <TabList>
                  <Tab>OracleKeeper </Tab>
                  <Tab>OrderTrigger</Tab>
                  <Tab>Liquidations</Tab>
                </TabList>

                <TabPanel>
                  <div className="flex">
                    <Signless checked={signLess} signToggle={signToggle} />
                    <div className="isDeployed">
                      <p style={{ fontWeight: "300" }}>
                        User:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {signerAddress?.substring(0, 6) +
                            "..." +
                            signerAddress?.substring(
                              signerAddress?.length - 4,
                              signerAddress?.length
                            )}
                        </span>
                      </p>

                      <p style={{ fontWeight: "300" }}>
                        nrOrders:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {orders.length}
                          <span style={{ position: "relative", top: "5px" }}>
                            <BiRefresh
                              color="white"
                              cursor={"pointer"}
                              fontSize={"20px"}
                              onClick={doRefresh}
                            />
                          </span>
                        </span>
                      </p>
                      <Button onClick={() => onAction(0)}> SetOrder</Button>
                      {orders.length > 0 && (
                        <div className="table-master">
                          <div className="table">
                            <p className="table-header table-header-title">
                              {" "}
                              OrderId
                            </p>{" "}
                            <p
                              style={{ width: "100px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              Timestamp
                            </p>{" "}
                            <p
                              style={{ width: "150px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              PublishTime
                            </p>
                            <p
                              style={{ width: "150px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              PriceSettled
                            </p>
                          </div>
                          {orders.map((val, index) => {
                            return (
                              <div key={index} className="table">
                                <p className="table-header"> {val.orderId}</p>{" "}
                                <p
                                  style={{ width: "100px" }}
                                  className="table-header"
                                >
                                  {" "}
                                  {val.timestamp}
                                </p>{" "}
                                <p
                                  style={{ width: "150px" }}
                                  className="table-header"
                                >
                                  {" "}
                                  {val.publishTime}
                                </p>
                                <p
                                  style={{ width: "150px" }}
                                  className="table-header"
                                >
                                  {" "}
                                  {val.priceSettled}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </TabPanel>
                <TabPanel>
                  <div className="flex">
                    <Signless checked={signLess} signToggle={signToggle} />
                    <div className="isDeployed">
                      <p style={{ fontWeight: "300" }}>
                        User:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {signerAddress?.substring(0, 6) +
                            "..." +
                            signerAddress?.substring(
                              signerAddress?.length - 4,
                              signerAddress?.length
                            )}
                        </span>
                      </p>
                      <p style={{ fontWeight: "300" }}>
                        nrOrders:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {conditionalOrders.length}
                          <span style={{ position: "relative", top: "5px" }}>
                            <BiRefresh
                              color="white"
                              cursor={"pointer"}
                              fontSize={"20px"}
                              onClick={doRefresh}
                            />
                          </span>
                        </span>
                      </p>
                      <Action
                        onClick={onAction}
                        onUpdate={onUpdate}
                        placeholder="Input Price"
                        text="Set Conditinal Order"
                        action={1}
                        amount={priceConditional}
                      />

                      <div className="table-master">
                        {conditionalOrders.length > 0 && (
                          <div className="table">
                            <p className="table-header table-header-title">
                              {" "}
                              OrderId
                            </p>{" "}
                            <p
                              style={{ width: "100px" }}
                              className="table-header  table-header-title"
                            >
                              {" "}
                              Timestamp
                            </p>{" "}
                            <p
                              style={{ width: "150px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              PublishTime
                            </p>
                            <p
                              style={{ width: "140px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              PriceUser
                            </p>
                            <p
                              style={{ width: "140px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              PriceSettled
                            </p>
                            <p
                              style={{ width: "100px" }}
                              className="table-header table-header-title"
                            >
                              {" "}
                              up/down
                            </p>
                          </div>
                        )}
                        {conditionalOrders.map((val, index) => {
                          return (
                            <div key={index} className="table">
                              <p className="table-header"> {val.orderId}</p>{" "}
                              <p
                                style={{ width: "100px" }}
                                className="table-header "
                              >
                                {" "}
                                {val.timestamp}
                              </p>{" "}
                              <p
                                style={{ width: "150px" }}
                                className="table-header"
                              >
                                {" "}
                                {val.publishTime}
                              </p>
                              <p
                                style={{ width: "140px" }}
                                className="table-header"
                              >
                                {" "}
                                {val.price.toFixed(4)}
                              </p>
                              <p
                                style={{ width: "140px" }}
                                className="table-header"
                              >
                                {" "}
                                {val.priceSettled?.toFixed(4)}
                              </p>
                              <p
                                style={{ width: "100px" }}
                                className="table-header"
                              >
                                {" "}
                                {val.above ? "up" : "down"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </TabPanel>
                <TabPanel>
                  <div className="flex">
                    <Signless checked={signLess} signToggle={signToggle} />
                    <div className="isDeployed">
                      <p style={{ fontWeight: "300" }}>
                        User:
                        <span
                          style={{ marginLeft: "10px", fontSize: "15px" }}
                          className="highlight"
                        >
                          {signerAddress?.substring(0, 6) +
                            "..." +
                            signerAddress?.substring(
                              signerAddress?.length - 4,
                              signerAddress?.length
                            )}
                        </span>
                      </p>
                      <p style={{ fontWeight: "200", fontSize: "14px" }}>
                        <span>
                          The order amount is fixed to 20000, the liquidation
                          threshold is 50%
                        </span>
                      </p>
                      {marginOrder == null ? (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "center",
                          }}
                        >
                          <Action
                            onClick={onAction}
                            onUpdate={onUpdate}
                            text="Set Margin Order"
                            placeholder="Input Leverage"
                            action={2}
                            amount={leverage}
                          />
                        </div>
                      ) : (
                        <div>
                          {marginOrder.active == true ? (
                            <div>
                              <p
                                style={{ fontWeight: "200", fontSize: "14px" }}
                              >
                                <span>
                                  You can add or remove collateral from your
                                  trade
                                </span>
                              </p>

                              <p style={{ fontWeight: "300" }}>
                                Active trade:
                                <span
                                  style={{
                                    marginLeft: "10px",
                                    fontSize: "15px",
                                  }}
                                  className="highlight"
                                >
                                  {marginOrder.active ? "true" : "false"}
                                  <span
                                    style={{ position: "relative", top: "5px" }}
                                  >
                                    <BiRefresh
                                      color="white"
                                      cursor={"pointer"}
                                      fontSize={"20px"}
                                      onClick={doRefresh}
                                    />
                                  </span>
                                </span>
                              </p>

                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  justifyContent: "center",
                                }}
                              >
                                <Action
                                  onClick={onAction}
                                  onUpdate={onUpdate}
                                  text="Add"
                                  placeholder="Input Amount"
                                  action={3}
                                  amount={addCollateral}
                                />

                                <Action
                                  onClick={onAction}
                                  onUpdate={onUpdate}
                                  text="Remove"
                                  placeholder="Input Amount"
                                  action={4}
                                  amount={removeCollateral}
                                />
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p
                                style={{ fontWeight: "200", fontSize: "14px" }}
                              >
                                <span>
                                  Your trade has been{" "}
                                  <span
                                    style={{ color: "red", fontWeight: "700" }}
                                  >
                                    liquidated
                                  </span>
                                  , please set a new order
                                </span>
                              </p>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  justifyContent: "center",
                                }}
                              >
                                <Action
                                  onClick={onAction}
                                  onUpdate={onUpdate}
                                  text="Set New Margin Order"
                                  placeholder="Input Leverage"
                                  action={2}
                                  amount={leverage}
                                />
                              </div>
                            </div>
                          )}
                          <div className="table-master">
                            <div className="table">
                              <p className="table-header table-header-title">
                                {" "}
                                OrderId
                              </p>{" "}
                              <p
                                style={{ width: "100px" }}
                                className="table-header table-header-title"
                              >
                                {" "}
                                Timestamp
                              </p>{" "}
                              <p
                                style={{ width: "100px" }}
                                className="table-header table-header-title"
                              >
                                {" "}
                                Amount
                              </p>
                              <p
                                style={{ width: "100px" }}
                                className="table-header table-header-title"
                              >
                                {" "}
                                Tokens
                              </p>
                              <p
                                style={{ width: "150px" }}
                                className="table-header table-header-title"
                              >
                                {" "}
                                PriceUser
                              </p>
                              <p
                                style={{ width: "100px" }}
                                className="table-header table-header-title"
                              >
                                {" "}
                                Threshold
                              </p>
                            </div>

                            <div className="table">
                              <p className="table-header ">
                                {" "}
                                {marginOrder.orderId}
                              </p>{" "}
                              <p
                                style={{ width: "100px" }}
                                className="table-header"
                              >
                                {" "}
                                {marginOrder.timestamp}
                              </p>{" "}
                              <p
                                style={{ width: "100px" }}
                                className="table-header"
                              >
                                {" "}
                                {marginOrder.amount}
                              </p>
                              <p
                                style={{ width: "100px" }}
                                className="table-header"
                              >
                                {" "}
                                {marginOrder.tokens?.toFixed(4)}
                              </p>
                              <p
                                style={{ width: "150px" }}
                                className="table-header"
                              >
                                {" "}
                                {marginOrder.price}
                              </p>
                              <p
                                style={{ width: "100px" }}
                                className="table-header"
                              >
                                {" "}
                                {marginOrder.threshold?.toFixed(2)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </TabPanel>
              </Tabs>
            </main>
          </div>
        )}{" "}
        {connectStatus?.state! == State.missing && (
          <p style={{ textAlign: "center" }}>Metamask not Found</p>
        )}
        {(connectStatus?.state == State.pending ||
          connectStatus?.state == State.failed) && (
          <div style={{ textAlign: "center", marginTop: "20px" }}>
            <h3> Please connect your metamask</h3>
            <Button status={connectStatus} onClick={onConnect}>
              <img src={metamask} width={25} height={25} />{" "}
              <span style={{ position: "relative", top: "-6px" }}>
                Connect{" "}
              </span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
