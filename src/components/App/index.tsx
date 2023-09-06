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
import { perpMockAbi } from "../../assets/contracts/perpMockAbi";

export interface IORDER {
  orderId: number;
  timestamp: number;
  amount: number;
  price: number;
  publishTime: number;
  above?: boolean;
  leverage?: number;
}

const App = () => {
  const GELATO_RELAY_API_KEY = "G0v7iVKdiGNkVWa_eISU7tH8iB0O7UlwWNOakmIXlOw_";
  let destroyFetchTask: Subject<void> = new Subject();
  let txHash: string | undefined;
  const relay = new GelatoRelay();

  const localStorage = new LocalStorage();

  const [sessionKeyContract, setSessionKeyContract] = useState<Contract>();
  const [counterContract, setCounterContract] = useState<Contract>();
  const [perpMockContract, setPerpMockContract] = useState<Contract>();

  const [ready, setReady] = useState(false);

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
  const [marginOrders, setMarginOrders] = useState<Array<IORDER>>([]);

  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [signLess, setSignLess] = useState<boolean>(false);
  const [tabIndex, setTabIndex] = useState(0);

  const [max, setMax] = useState<boolean>(false);
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
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      if (currentChainId !== "0x66eed") {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x66eed" }],
        });
      }
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
        console.log("trading");

        if (signLess) {
          tradeSignLess();
        } else {
          setOrder();
        }

        break;
      case 1:
        break;

      default:
        setLoading(false);
        break;
    }
  };

  const setOrder = async () => {
    try {
      setMessage({
        header: "Waiting for tx...",
        body: undefined,
        taskId: undefined,
      });
      setLoading(true);
      let perpMockContract = await getPerpMockContract(provider!);
      let tx = await perpMockContract?.setOrder(1000);
      await tx.wait();
      setTimeout(() => {
        doRefresh();
      }, 2000);
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };

  const trade = async () => {
    try {
      setMessage({
        header: "Waiting for tx...",
        body: undefined,
        taskId: undefined,
      });
      setLoading(true);
      let counterContract = await getCounterContract(provider!);
      let tx = await counterContract?.increment();
      await tx.wait();
      setTimeout(() => {
        doRefresh();
      }, 2000);
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };
  const tradeSignLess = async () => {
    setMessage({
      header: "Relaying the transaction",
      body: undefined,
      taskId: undefined,
    });
    setLoading(true);

    let tmpCountercontract = await getCounterContract(provider!);
    let tmpSessionKeyContract = await getSessionContract(provider!);
    const { data: dataCounter } =
      await tmpCountercontract!.increment.populateTransaction();

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);
    const sessionKey = localStorage.get(StorageKeys.SESSION_KEY);

    const tempKey = new TempKey(sessionKey);

    console.log(sessionId);

    let { data: dataExecute } =
      await tmpSessionKeyContract!.executeCall.populateTransaction(
        await tmpCountercontract?.getAddress()!,
        dataCounter!,
        0,
        sessionId
      );

    const signer = new ethers.Wallet(sessionKey as string, provider!);

    const request: CallWithERC2771Request = {
      chainId: BigInt(5),
      target: await tmpSessionKeyContract?.getAddress()!,
      data: dataExecute as string,
      user: tempKey.address as string,
    };

    const response = await relay.sponsoredCallERC2771(
      request,
      signer,
      GELATO_RELAY_API_KEY as string
    );

    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);
    fetchStatus(response.taskId);
  };

  //// Tak Status per TaskId Id
  const fetchStatus = async (taskIdToQuery: string) => {
    const numbers = interval(1000);

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
        console.log(204, details.taskState);

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
    console.log(357, index);
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
      console.log(+orderId.toString());
      let orderResult = await perpMockContract.getOrder(+orderId.toString());
      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        publishTime: +orderResult["publishTime"].toString(),
        amount: +orderResult["amount"].toString(),
        price: +orderResult["price"].toString(),
      };

      _orders.push(order);
    }
    console.log(_orders);
    setOrders(_orders);
  };

  const readConditionalOrders = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    let perpMockContract = await getPerpMockContract(provider);

    let totalOrders = await perpMockContract.nrConditionalOrdersByUser(signerAddress);

    const _orders = [];
    for (let i = 0; i < +totalOrders.toString(); i++) {
      let orderId = await perpMockContract.consitionslOrdersByUser.staticCallResult(
        signerAddress,
        i
      );
      console.log(+orderId.toString());
      let orderResult = await perpMockContract.getOrder(+orderId.toString());
      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        publishTime: +orderResult["publishTime"].toString(),
        amount: +orderResult["amount"].toString(),
        price: +orderResult["price"].toString(),
      };

      _orders.push(order);
    }
    console.log(_orders);
    setOrders(_orders);
  };

  const readMarginTrades = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    let perpMockContract = await getPerpMockContract(provider);

    let totalOrders = await perpMockContract.nrMarginTradesByUser(signerAddress);

    const _orders = [];
    for (let i = 0; i < +totalOrders.toString(); i++) {
      let orderId = await perpMockContract.marginTradesByUser.staticCallResult(
        signerAddress,
        i
      );
      console.log(+orderId.toString());
      let orderResult = await perpMockContract.getOrder(+orderId.toString());
      let order: IORDER = {
        orderId: +orderId.toString(),
        timestamp: +orderResult["timestamp"].toString(),
        publishTime: +orderResult["publishTime"].toString(),
        amount: +orderResult["amount"].toString(),
        price: +orderResult["price"].toString(),
      };

      _orders.push(order);
    }
    console.log(_orders);
    setOrders(_orders);
  };


  const refreshTab = async (index: number) => {
    switch (index) {
      case 1:
        await readOrders(provider!, signerAddress!);
        break;
        case 2:
        await readConditionalOrders(provider!, signerAddress!);
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
      console.log(405, signerAddress);
      readOrders(provider, signerAddress);

      setLoading(false);
    } else {
      setLoading(false);
      setConnectStatus({ state: State.failed, message: "Connection Failed" });
    }

    //
    // console.log(signer);
  };

  const getSessionContract = async (provider: ethers.BrowserProvider) => {
    if (sessionKeyContract == undefined) {
      const sessionKeyAddress = "0x5B91C8E7a2DEABC623E6Ab34E8c26F27Cc18bC66";
      const _sessionKeyContract = new ethers.Contract(
        sessionKeyAddress,
        sessionKeyAbi,
        provider
      );

      setSessionKeyContract(_sessionKeyContract);
      return _sessionKeyContract;
    } else {
      return sessionKeyContract;
    }
  };

  const getCounterContract = async (provider: ethers.BrowserProvider) => {
    if (counterContract == undefined) {
      const signer = await provider?.getSigner();
      const counterAddress = "0x87CA985c8F3e9b70bCCc25bb67Ae3e2F6f31F51C";
      const _counterContract = new ethers.Contract(
        counterAddress,
        counterAbi,
        signer
      );

      setCounterContract(counterContract);
      return _counterContract;
    } else {
      return counterContract;
    }
  };
  const getPerpMockContract = async (provider: ethers.BrowserProvider) => {
    if (perpMockContract == undefined) {
      const signer = await provider?.getSigner();
      const perpMockAddress = "0x5115B85246bb32dCEd920dc6a33E2Be6E37fFf6F";
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
  const getSession = async (provider: ethers.BrowserProvider) => {
    const contract = await getSessionContract(provider);

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);

    const packed = ethers.solidityPacked(["string"], [sessionId]);
    const hash = ethers.keccak256(packed);

    const session = await contract.sessions(hash);

    return session;
  };



  const signToggle = async () => {
    setSignLess(!signLess);
    if (!signLess) {
      startSignLess();
    }
  };

  const startSignLess = async () => {
    setMessage({
      header: "Cheking Keys",
      body: "Retrieving new Session Key...",
      taskId: undefined,
    });

    setLoading(true);

    const localStorage = new LocalStorage();
    let _sessionId = localStorage.get(StorageKeys.SESSION_ID);
    let _sessionKey = localStorage.get(StorageKeys.SESSION_KEY);
    console.log(_sessionId, _sessionKey);

    if (_sessionId == null || _sessionKey == null) {
      createSessionKeys();
    } else {
      const session = await getSession(provider!);
      const tempKey = new TempKey(_sessionKey);
      const tempAddress = tempKey.address;
      console.log(session);

      const timestamp = Math.floor(Date.now() / 1000);
      console.log(timestamp, +session.end.toString());
      if (
        tempAddress !== session.tempPublicKey ||
        timestamp > +session.end.toString()
      ) {
        console.log("SESSION KEYS");
        setMessage({
          header: "Session Key Invalid",
          body: "Creating new Session Key...",
          taskId: undefined,
        });
        setTimeout(() => {
          createSessionKeys();
        }, 1000);
      } else {
        setLoading(false);
      }
    }
  };

  const createSessionKeys = async () => {
    console.log("CREATING NEW TMPKEY");
    setMessage({
      header: "Creating New Session",
      body: "Preparing tx...",
      taskId: undefined,
    });

    // Generate the target payload
    const sessionKeyAddress = "0xde2568192B20A57dE387132b54C3fa492E334837";
    const sessionKeyContract = new ethers.Contract(
      sessionKeyAddress,
      sessionKeyAbi,
      provider!
    );

    const sessionId = uuidv4(); // ⇨ '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'

    const tempKey = new TempKey();

    const tempAddress = tempKey.address;
    console.log(tempKey.privateKey);

    localStorage.save(StorageKeys.SESSION_ID, sessionId);
    localStorage.save(StorageKeys.SESSION_KEY, tempKey.privateKey);

    console.log(sessionId, tempAddress);

    const { data } = await sessionKeyContract.createSession.populateTransaction(
      sessionId,
      3600,
      tempAddress
    );
    setMessage({
      header: "Creating New Session",
      body: "Relaying tx",
      taskId: undefined,
    });
    // Populate a relay request
    const request: CallWithERC2771Request = {
      chainId: BigInt(5),
      target: sessionKeyAddress,
      data: data as string,
      user: signerAddress!,
    };

    const response = await relay.sponsoredCallERC2771(
      request,
      provider!,
      GELATO_RELAY_API_KEY as string
    );
    setMessage({
      header: "Creating New Session",
      body: "Waiting for tx.",
      taskId: undefined,
    });
    console.log(`https://relay.gelato.digital/tasks/status/${response.taskId}`);

    fetchStatus(response.taskId);
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

        if (currentChainId !== "0x66eed") {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x66eed" }],
          });
        }
        const web3Provider = new ethers.BrowserProvider(window.ethereum);
        refresh(web3Provider);
      }
    })();
  }, []);

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
                      <Button ready={ready} onClick={() => onAction(0)}>
                        {" "}
                        SetOrder
                      </Button>
                      <div className="table-master">
                        <div className="table">
                          <p className="table-header"> OrderId</p> <p style={{ width:'100px'}}className="table-header"> Timestamp</p> <p style={{ width:'150px'}} className="table-header"> PublishTime</p>
                          <p className="table-header"> Price</p>
                        </div>
                        {orders.map((val, index) => {
                          return  <div className="table">
                          <p className="table-header"> {val.orderId}</p> <p style={{ width:'100px'}}className="table-header"> {val.timestamp}</p> <p style={{ width:'150px'}} className="table-header"> {val.publishTime}</p>
                          <p className="table-header"> {val.price}</p>
                        </div>;
                        })}
                      </div>
                  
               
                    </div>
                  </div>
                </TabPanel>
                <TabPanel>
                  <h2>Any content 2</h2>
                </TabPanel>
                <TabPanel>
                  <h2>Any content 3</h2>
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
            <Button status={connectStatus} ready={ready} onClick={onConnect}>
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
