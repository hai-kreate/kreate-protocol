import { Hex } from "@/types";

import { header, helios, module } from "../../program";

export type Params = {
  projectAtMph: Hex;
  protocolNftMph: Hex;
};

export default function main({ projectAtMph, protocolNftMph }: Params) {
  return helios`
    ${header("spending", "v__project_script")}

    import { Datum, Redeemer }
      from ${module("v__project_script__types")}
    import { Datum as ProjectDatum, ProjectStatus }
      from ${module("v__project__types")}
    import { Datum as PParamsDatum }
      from ${module("v__protocol_params__types")}
    import {
      Datum as OpenTreasuryDatum,
      Redeemer as OpenTreasuryRedeemer
    } from ${module("v__open_treasury__types")}
    import { Redeemer as ProjectAtRedeemer }
      from ${module("at__project__types")}
    import { Redeemer as ProjectDetailRedeemer }
      from ${module("v__project_detail__types")}
    import { UserTag }
      from ${module("common__types")}

    import {
      script_hash_to_staking_credential,
      is_tx_authorized_by,
      find_pparams_datum_from_inputs,
      staking_credential_to_validator_hash
    } from ${module("helpers")}

    import {
      RATIO_MULTIPLIER,
      TREASURY_UTXO_MIN_ADA,
      PROJECT_AT_TOKEN_NAME,
      PROJECT_DETAIL_AT_TOKEN_NAME,
      PROJECT_SCRIPT_AT_TOKEN_NAME,
      PROJECT_SCRIPT_DELIST_DISCOUNT_CENTS,
      PROJECT_SCRIPT_CLOSE_DISCOUNT_CENTS
    } from ${module("constants")}

    const PROJECT_AT_MPH: MintingPolicyHash =
      MintingPolicyHash::new(#${projectAtMph})

    const PROJECT_AT_ASSET_CLASS: AssetClass =
      AssetClass::new(PROJECT_AT_MPH, PROJECT_AT_TOKEN_NAME)

    const PROJECT_DETAIL_AT_ASSET_CLASS: AssetClass =
      AssetClass::new(PROJECT_AT_MPH, PROJECT_DETAIL_AT_TOKEN_NAME)

    const PROJECT_SCRIPT_AT_ASSET_CLASS: AssetClass =
      AssetClass::new(PROJECT_AT_MPH, PROJECT_SCRIPT_AT_TOKEN_NAME)

    const PROTOCOL_NFT_MPH: MintingPolicyHash =
      MintingPolicyHash::new(#${protocolNftMph})

    func is_project_txout (output: TxOutput) -> Bool {
      output.value.get_safe(PROJECT_AT_ASSET_CLASS) == 1
    }

    func main(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool {
      tx: Tx = ctx.tx;

      own_input_txout: TxOutput = ctx.get_current_input().output;
      own_validator_hash: ValidatorHash = ctx.get_current_validator_hash();

      pparams_datum: PParamsDatum =
        find_pparams_datum_from_inputs(tx.ref_inputs, PROTOCOL_NFT_MPH);

      redeemer.switch {
        Migrate => {
          migration_asset_class: AssetClass =
            pparams_datum
              .registry
              .project_script_validator
              .migrations
              .get(own_validator_hash);

          tx.minted.get_safe(migration_asset_class) != 0
        },
        else => {
          assert(
            own_validator_hash
              == pparams_datum.registry.project_script_validator.latest,
            "Wrong script version"
          );

          staking_script_hash: ScriptHash = own_input_txout.ref_script_hash.unwrap();
          staking_credential: StakingCredential =
            script_hash_to_staking_credential(staking_script_hash);

          staking_validator_hash: StakingValidatorHash =
            StakingValidatorHash::from_script_hash(staking_script_hash);

          project_txout: TxOutput =
            tx.ref_inputs
              .map((input: TxInput) -> TxOutput { input.output })
              .find_safe(is_project_txout)
              .switch {
                None => tx.outputs.find(is_project_txout),
                s: Some => s.some
              };

          project_datum: ProjectDatum =
            project_txout.datum.switch {
              i: Inline => ProjectDatum::from_data(i.data),
              else => error("Invalid Project utxo: missing inline datum")
            };

          assert(
            project_datum.project_id == datum.project_id,
            "Incorrect project UTxO"
          );

          project_at_purpose: ScriptPurpose =
            ScriptPurpose::new_minting(PROJECT_AT_MPH);

          project_at_redeemer: Data = tx.redeemers.get(project_at_purpose);

          does_burn_project_at_with_correct_redeemer: Bool =
            ProjectAtRedeemer::from_data(project_at_redeemer).switch {
              DeallocateStaking => true,
              else => false
            };

          assert(
            does_burn_project_at_with_correct_redeemer,
            "Burn project auth token with incorrect redeemer"
          );

          assert(
            tx.minted.get_policy(PROJECT_AT_MPH).all(
              (_, amount: Int) -> Bool { amount < 0 }
            ),
            "Burn project auth token incorrect amount"
          );

          does_deregister_correctly: Bool =
            tx.dcerts.any(
              (dcert: DCert) -> Bool {
                dcert.switch {
                  deregister: Deregister => deregister.credential == staking_credential,
                  else => false
                }
              }
            );

          assert(
            does_deregister_correctly,
            "Deregister incorrect staking credential"
          );

          redeemer.switch {
            Close => {
              does_pass_project_datum_check: Bool =
                project_datum.status.switch {
                  PreClosed => {
                    project_detail_txinput: TxInput =
                      tx.inputs
                        .find(
                          (input: TxInput) -> Bool {
                            input.output.value.get_safe(PROJECT_DETAIL_AT_ASSET_CLASS) == 1
                          }
                        );

                    project_detail_purpose: ScriptPurpose =
                      ScriptPurpose::new_spending(project_detail_txinput.output_id);

                    project_detail_redeemer: Data = tx.redeemers.get(project_detail_purpose);

                    ProjectDetailRedeemer::from_data(project_detail_redeemer).switch {
                      WithdrawFunds => true,
                      else => error("Incorrect project detail redeemer")
                    }
                  },
                  Closed => {
                    withdrawn_rewards: Int =
                      tx.withdrawals.get_safe(staking_credential).switch {
                        None => error("Missing stake withdrawals"),
                        s: Some => s.some
                      };

                    if (withdrawn_rewards == 0) {
                      true
                    } else if (withdrawn_rewards < TREASURY_UTXO_MIN_ADA) {
                      open_treasury_input: TxInput =
                        tx.inputs.find(
                          (input: TxInput) -> Bool {
                            input.output.address.credential
                              == Credential::new_validator(
                                  pparams_datum.registry
                                    .open_treasury_validator
                                    .latest
                                )
                          }
                        );

                      open_treasury_purpose: ScriptPurpose =
                        ScriptPurpose::new_spending(open_treasury_input.output_id);

                      open_treasury_redeemer: Data =
                        tx.redeemers.get(open_treasury_purpose);

                      OpenTreasuryRedeemer::from_data(open_treasury_redeemer).switch {
                        collect: CollectDelayedStakingRewards => {
                          collect.staking_withdrawals.get(staking_validator_hash)
                            == withdrawn_rewards
                        },
                        else => error("Incorrect open treasury redeemer")
                      }

                    } else {
                      tx.outputs.any(
                        (output: TxOutput) -> Bool {
                          output.address == Address::new(
                            Credential::new_validator(
                              pparams_datum.registry
                                .open_treasury_validator
                                .latest
                            ),
                            Option[StakingCredential]::Some{
                              script_hash_to_staking_credential(
                                pparams_datum.registry.protocol_staking_validator
                              )
                            }
                          )
                            && output.value == Value::lovelace(withdrawn_rewards)
                            && output.datum.switch {
                              i: Inline => {
                                open_treasury_datum: OpenTreasuryDatum = OpenTreasuryDatum::from_data(i.data);

                                open_treasury_datum.governor_ada
                                    == withdrawn_rewards * pparams_datum.governor_share_ratio / RATIO_MULTIPLIER
                                  && open_treasury_datum.tag.switch {
                                    tag: TagProjectDelayedStakingRewards => {
                                      tag.staking_validator.unwrap() == staking_validator_hash
                                    },
                                    else => false
                                  }
                              },
                              else => false
                            }
                        }
                      )
                    }
                  },
                  else => error("Wrong project status")
                };

              assert(
                true || does_pass_project_datum_check,
                "Incorrect project status"
              );

              if(is_tx_authorized_by(tx, project_datum.owner_address.credential)){
                true
              } else {
                (is_tx_authorized_by(tx, pparams_datum.staking_manager)
                  || is_tx_authorized_by(tx, pparams_datum.governor_address.credential)
                )
                  && tx.outputs.any(
                    (output: TxOutput) -> Bool {
                      output.address == project_datum.owner_address
                        && output.value >=
                            own_input_txout.value
                              + Value::lovelace(
                                  datum.stake_key_deposit
                                    - pparams_datum.discount_cent_price * PROJECT_SCRIPT_CLOSE_DISCOUNT_CENTS
                                )
                        && output.datum.switch {
                          i: Inline =>
                            UserTag::from_data(i.data).switch {
                              tag: TagProjectScriptClosed =>
                                tag.project_id == datum.project_id
                                  && tag.staking_validator == staking_credential_to_validator_hash(staking_credential),
                                else => false
                            },
                          else => false
                        }
                    }
                  )
              }

            },
            Delist => {
              withdrawn_rewards: Int = tx.withdrawals.get(staking_credential);

              is_output_project_datum_valid: Bool =
                project_datum.status.switch {
                  Delisted => true,
                  else => false
                };

              treasury_ada: Int =
                own_input_txout.value.get_safe(AssetClass::ADA)
                  + withdrawn_rewards
                  + datum.stake_key_deposit
                  - pparams_datum.discount_cent_price * PROJECT_SCRIPT_DELIST_DISCOUNT_CENTS;

              is_treasury_txout_valid: Bool =
                tx.outputs.any(
                  (output: TxOutput) -> Bool {
                    output.address == Address::new(
                      Credential::new_validator(
                        pparams_datum.registry
                          .open_treasury_validator
                          .latest
                      ),
                      Option[StakingCredential]::Some{
                        script_hash_to_staking_credential(
                          pparams_datum.registry.protocol_staking_validator
                        )
                      }
                    )
                      && output.value.get(AssetClass::ADA) >= treasury_ada
                      && output.datum.switch {
                        i: Inline => {
                          open_treasury_datum: OpenTreasuryDatum = OpenTreasuryDatum::from_data(i.data);

                          open_treasury_datum.governor_ada
                              == output.value.get(AssetClass::ADA)
                                  * pparams_datum.governor_share_ratio / RATIO_MULTIPLIER
                            && open_treasury_datum.tag.switch {
                                  tag: TagProjectScriptDelisted =>
                                    tag.project_id == datum.project_id
                                      && tag.staking_validator == staking_validator_hash,
                                  else => false
                                }
                        },
                        else => false
                      }
                  }
                );

              (is_tx_authorized_by(tx, pparams_datum.staking_manager)
                || is_tx_authorized_by(tx, pparams_datum.governor_address.credential)
              )
                && is_output_project_datum_valid
                && is_treasury_txout_valid
            },
            else => {
              false
            }
          }
        }
      }
    }
  `;
}
