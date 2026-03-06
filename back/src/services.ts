import { AuthService } from './modules/auth/auth.service';
import { LobbyService } from './modules/lobby/lobby.service';
import { MatchService } from './modules/match/match.service';
import { WalletService } from './modules/wallet/wallet.service';

export interface AppServices {
  auth: AuthService;
  lobby: LobbyService;
  match: MatchService;
  wallet: WalletService;
}
