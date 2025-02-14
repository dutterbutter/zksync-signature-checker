import { expect } from "chai";
import { Wallet, Provider, Contract, utils } from "zksync-web3";
import * as hre from "hardhat";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as ethers from "ethers";
import "@matterlabs/hardhat-zksync-chai-matchers";

import { deployContract, fundAccount } from "./testHelpers";

import dotenv from "dotenv";
import { Address } from "zksync-web3/build/src/types";
dotenv.config();

const Whale =
  "0x850683b40d4a740aa6e745f889a6fdc8327be76e122f5aba645a5b02d0248db8";

// puublic address = "0x4826ed1D076f150eF2543F72160c23C7B519659a";
const Verifier_PK =
  "0x8f6e509395c13960f501bc7083450ffd0948bc94103433d5843e5060a91756da";

const GAS_LIMIT = 6_000_000;

describe("ERC20Paymaster", function () {
  let provider: Provider;
  let whale: Wallet;
  let deployer: Deployer;
  let userWallet: Wallet;
  let verifier: Wallet;
  let initialBalance: ethers.BigNumber;
  let initialBalance_ERC20: ethers.BigNumber;
  let paymaster: Contract;
  let erc20: Contract;

  before(async function () {
    provider = new Provider(hre.userConfig.networks?.zkSyncTestnet?.url);
    whale = new Wallet(Whale, provider);
    deployer = new Deployer(hre, whale);
    verifier = new Wallet(Verifier_PK, provider);
    userWallet = Wallet.createRandom();
    userWallet = new Wallet(userWallet.privateKey, provider);
    // console.log("Private key: ", userWallet.privateKey);
    // console.log("Public key: ", userWallet.address);
    initialBalance = await userWallet.getBalance();

    erc20 = await deployContract(deployer, "MockERC20", [
      "TestToken",
      "Test",
      18,
    ]);
    paymaster = await deployContract(deployer, "Paymaster", [verifier.address]);

    await fundAccount(whale, paymaster.address, "13");
    await (await erc20.mint(userWallet.address, 130)).wait();
    initialBalance_ERC20 = await erc20.balanceOf(userWallet.address);
  });

  async function executeTransaction(
    user: Wallet,
    token: Address,
    payType: "ApprovalBased" | "General"
  ) {
    const gasPrice = await provider.getGasPrice();
    const minimalAllowance = ethers.BigNumber.from(1);

    const messageHash = await getMessageHash(token);

    const SignedMessageHash = await verifier.signMessage(messageHash);
    console.log("Message hash: ", messageHash.toString());
    console.log("Signed message hash: ", SignedMessageHash.toString());
    console.log("User address: ", user.address.toString());
    console.log("ERC20 address: ", token.toString());
    console.log("Minimal allowance: ", minimalAllowance.toString());
    // console.log("Expiration: ", expiration.toString());
    console.log("Max fee per gas: ", gasPrice.toString);
    console.log("Gas limit: ", GAS_LIMIT.toString());

    // const innerInput = ethers.utils.solidityPack(
    //   [ "bytes","address", "uint256"],
    //   [SignedMessageHash, user.address, expiration]
    // );
    const innerInput = ethers.utils.solidityPack(
      ["bytes"],
      [SignedMessageHash]
    );
    console.log("Inner input: ", innerInput);

    const paymasterParams = utils.getPaymasterParams(
      paymaster.address.toString(),
      {
        type: payType,
        token: token,
        minimalAllowance,
        innerInput: SignedMessageHash,
      }
    );

    console.log("Paymaster params: ", paymasterParams);

    await (
      await erc20.connect(userWallet).mint(user.address, 5, {
        maxPriorityFeePerGas: ethers.BigNumber.from(0),
        maxFeePerGas: gasPrice,
        gasLimit: GAS_LIMIT,
        customData: {
          paymasterParams: paymasterParams,
          gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        },
      })
    ).wait();
    console.log(
      "Verify signature:",
      await utils.isMessageSignatureCorrect(
        provider,
        verifier.address,
        messageHash,
        SignedMessageHash
      )
    );
    const ethSignedMessage = await paymaster.signedMessagePublic();
    const ethMessageHash = await paymaster.messageHashPublic();
    console.log(
      "Message hash transfer: ",
      messageHash == ethMessageHash,
      ethMessageHash
    );
    console.log(
      "Signed Message transfer: ",
      SignedMessageHash == ethSignedMessage,
      ethSignedMessage
    );
  }

  // In solidity:
  // keccak256(abi.encodePacked())
  async function getMessageHash(_token: Address) {
    return ethers.utils.solidityKeccak256(
      ["address"],
      [_token]
    );
  }

  it("Should validate and pay for paymaster transaction", async function () {
    const verifierAddress = await paymaster.verifier();
    expect(verifierAddress).to.be.eql(verifier.address);

    await executeTransaction(userWallet, erc20.address, "ApprovalBased");
    const newBalance = await userWallet.getBalance();
    const newBalance_ERC20 = await erc20.balanceOf(userWallet.address);
    expect(newBalance).to.be.eql(initialBalance);
    expect(newBalance_ERC20).to.be.eql(initialBalance_ERC20.add(4)); //5 minted - 1 fee
    console.log("Initial ERC20 balance: ", initialBalance_ERC20.toString());
    console.log("New ERC20 balance: ", newBalance_ERC20.toString());
    console.log(
      "ERC20 allowance: ",
      (await erc20.allowance(userWallet.address, paymaster.address)).toString()
    );
  });
});
