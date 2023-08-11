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
import { } from 'ethers'

const App = () => {

  const GELATO_RELAY_API_KEY = "G0v7iVKdiGNkVWa_eISU7tH8iB0O7UlwWNOakmIXlOw_";
  let destroyFetchTask: Subject<void> = new Subject();
  let txHash: string | undefined;
  const relay = new GelatoRelay();

  const localStorage = new LocalStorage();

  const [sessionKeyContract, setSessionKeyContract] =
    useState<Contract>();
  const [counterContract, setCounterContract] = useState<Contract>();

  const [ready, setReady] = useState(false);

  const [provider, setProvider] =
    useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [message, setMessage] = useState<Message>({
    header: "Loading",
    body: undefined,
    taskId: undefined,
  });
  const [counter, setCounter] = useState<string>("Loading");
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [signLess, setSignLess] = useState<boolean>(false);
  const [chainId, setChainId] = useState<Chain>({ name: "", id: 0 });

  const [dedicatedMsgSender, setDedicatedMsgSender] =
    useState<DedicatedMsgSender>({
      address: "",
      isDeployed: false,
      balance: "0",
    });

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

    window.ethereum.on("chainChanged",async  () => {
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      setLoading(true);
      refresh(web3Provider);
      localStorage.remove(StorageKeys.SESSION_ID);
      localStorage.remove(StorageKeys.SESSION_KEY);
      const currentChainId = await window.ethereum.request({
        method: "eth_chainId",
      });

      if (currentChainId !== "0x5") {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x5" }],
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
          trade();
        }

        break;
      case 1:
        break;

      default:
        setLoading(false);
        break;
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
      let tx =await counterContract?.increment()
      await tx.wait()
      setTimeout(()=> {  doRefresh()}, 2000)
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

    let tmpCountercontract = await getCounterContract(provider!)
    let tmpSessionKeyContract = await getSessionContract(provider!)
    const { data: dataCounter } = await tmpCountercontract!.increment.populateTransaction();

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);
    const sessionKey = localStorage.get(StorageKeys.SESSION_KEY);
    
    const tempKey = new TempKey(sessionKey);

    console.log(sessionId)

    let { data: dataExecute } =
       await tmpSessionKeyContract!.executeCall.populateTransaction(
        await tmpCountercontract?.getAddress()!,
         dataCounter!,
         0,
         sessionId
       );

  
      const signer = new ethers.Wallet(sessionKey as string, provider!);
      
      const request: CallWithERC2771Request = {
        chainId:BigInt(5),
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
      fetchStatus(response.taskId)

  };

  const fetchStatus = async (taskIdToQuery: string) => {
    const numbers = interval(1000);

    const takeFourNumbers = numbers.pipe(takeUntil(destroyFetchTask));

    takeFourNumbers.subscribe(async (x) => {
      try {
        
        let status = await relay.getTaskStatus(taskIdToQuery)
    


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
      console.log(204, details.taskState)
 
        switch (details.taskState!) {
          case TaskState.WaitingForConfirmation:
            header = `Transaction Relayed`;
            body = `Waiting for Confirmation`
            break;
          case TaskState.Pending:
            header = `Transaction Relayed`;
            body = `Pending Status`;
           

            break;
          case TaskState.CheckPending:
            header = `Transaction Relayed`;
            body =`Simulating Transaction`;
          
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
            setTimeout(()=> {  doRefresh()}, 2000)
           
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
          taskId:txHash,
        });

        // this.store.dispatch(
        //   Web3Actions.chainBusyWithMessage({
        //     message: {
        //       body: body,
        //       header: header,
        //     },
        //   })
        // );
      
    } catch (error) {
        
    }
    });
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

      getCounter(provider, signerAddress);

      setLoading(false);
    } else {
      setLoading(false);
      setConnectStatus({ state: State.failed, message: "Connection Failed" });
    }

    //
    // console.log(signer);
  };

  const getSessionContract = async (
    provider: ethers.BrowserProvider
  ) => {
    if (sessionKeyContract == undefined) {
      const sessionKeyAddress = "0xde2568192B20A57dE387132b54C3fa492E334837";
      const _sessionKeyContract = new ethers.Contract(
        sessionKeyAddress,
        sessionKeyAbi,
        provider
      ) ;

      setSessionKeyContract(_sessionKeyContract);
      return _sessionKeyContract;
    } else {
      return sessionKeyContract;
    }
  };

  const getCounterContract = async (
    provider: ethers.BrowserProvider
  ) => {
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

  const getSession = async (provider: ethers.BrowserProvider) => {
    const contract = await getSessionContract(provider);

    const sessionId = localStorage.get(StorageKeys.SESSION_ID);

    const packed = ethers.solidityPacked(["string"], [sessionId]);
    const hash = ethers.keccak256(packed);

    const session = await contract.sessions(hash);

    return session;
  };

  const getCounter = async (
    provider: ethers.BrowserProvider,
    signerAddress: string
  ) => {
    const contract = await getCounterContract(provider);

    const balance = await contract.counter(signerAddress);

    setCounter(balance.toString());
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
    ) ;

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

        if (currentChainId !== "0x5") {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x5" }],
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
          
              <div className="flex">
                <p className="title">
                 Trade Signless
                </p>
                <div className="isDeployed">
                  <p>User:</p>
                  <p className="highlight">
                    {signerAddress}
                    <span
                      style={{ position: "relative", top: "5px", left: "5px" }}
                    >
                      <BiCopy
                        cursor={"pointer"}
                        color="white"
                        fontSize={"20px"}
                        onClick={() => onCopy(signerAddress!)}
                      />
                    </span>
                  </p>
                  <p style={{ fontWeight: "600" }}>
                    Counter:
                    <span
                      style={{ marginLeft: "10px", fontSize: "15px" }}
                      className="highlight"
                    >
                      {counter}
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
                    Trade
                  </Button>
                  <p style={{marginTop:'10px'}}> <span style={{    position: 'relative',bottom: '9px'}}> Signless: </span><Switch onChange={signToggle} checked={signLess} /></p> 
                </div>
              </div>
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
