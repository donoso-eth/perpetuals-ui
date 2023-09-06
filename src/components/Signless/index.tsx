import { State, Status } from "../../types/Status";

import "./style.css";
import Switch from "react-switch";
interface SignlessProps {
  checked: boolean;
  signToggle: () => {};
}

const Signless = ({ checked, signToggle }: SignlessProps) => {
  return (
    <div  style={{flexDirection: 'row', width:'100%', justifyContent:'end', marginRight:'10px', fontSize:'14px'}} className="flex align-items-center">
      {" "}
      <p style={{ position: "relative" }}> Signless: </p>
      <div style={{ transform: 'scale(0.75)', position: 'relative',top: '2px',right: '8px'}} >
      <Switch  onChange={signToggle} checked={checked} />
      </div>
    </div>
  );
};

export default Signless;
