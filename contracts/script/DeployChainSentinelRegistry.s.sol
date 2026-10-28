// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ChainSentinelRegistry} from "../src/ChainSentinelRegistry.sol";

contract DeployChainSentinelRegistry is Script {
    function run() external returns (ChainSentinelRegistry registry) {
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address reporter = vm.envAddress("REPORTER_ADDRESS");

        vm.startBroadcast();
        registry = new ChainSentinelRegistry(admin, reporter);
        vm.stopBroadcast();

        console.log("chainId:", block.chainid);
        console.log("ChainSentinelRegistry:", address(registry));
    }
}
