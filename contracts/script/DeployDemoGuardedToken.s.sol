// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DemoGuardedToken} from "../src/fixtures/DemoGuardedToken.sol";

contract DeployDemoGuardedToken is Script {
    function run() external returns (DemoGuardedToken token) {
        vm.startBroadcast();
        token = new DemoGuardedToken(1_000_000e18);
        vm.stopBroadcast();

        console.log("chainId:", block.chainid);
        console.log("DemoGuardedToken:", address(token));
    }
}
