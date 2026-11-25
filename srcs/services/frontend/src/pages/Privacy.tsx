// Base unmodified text from: https://www.arte.gov.pt/web/arte/politica-de-privacidade
export default function Privacy() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12 text-ink">
      <header className="mb-8 pb-4 border-b border-line">
        <h1 className="text-3xl md:text-4xl font-bold font-display mb-3">
          Política de Privacidade
        </h1>
        <p className="text-sm text-muted">
          Última atualização: Novembro de 2026 · Plataforma Daka
        </p>
      </header>
      <div className="space-y-4 text-base leading-relaxed">
        <p>A proteção da privacidade e dos dados pessoais é uma prioridade para a plataforma Daka (&ldquo;Toma-lá, dá-cá&rdquo;) e um claro compromisso assumido por nós, em conformidade com o Regulamento Geral sobre a Proteção de Dados (RGPD — Regulamento UE 2016/679).</p>
        <p>Esta política diz respeito às práticas de privacidade no âmbito da plataforma Daka, incluindo a navegação, o registo de contas e a negociação de trocas de artigos em segunda mão. Os dados pessoais que nos forneça durante a interação com o serviço serão tratados com as garantias de segurança e confidencialidade exigidas pelo enquadramento legal aplicável.</p>
        <p>A plataforma pode conter ligações para sítios externos sob a responsabilidade de entidades terceiras. A política de privacidade do Daka aplica-se exclusivamente aos serviços sob sua gestão direta.</p>
        <p>O acesso e a utilização dos serviços do Daka devem ser livres por parte do utilizador, presumindo o Daka que este leu, compreendeu e aceitou os Termos de Serviço e a presente Política de Privacidade.</p>
        <p>Quaisquer tentativas de alterar a informação, ou qualquer outra ação que possa causar dano e pôr em risco a integridade do sistema, são estritamente proibidas de acordo com a legislação em vigor em matéria de criminalidade informática.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Contacto para Proteção de Dados</h2>
        <p>Para qualquer esclarecimento sobre a presente política ou sobre o tratamento dos seus dados pessoais, pode contactar os administradores da plataforma através dos canais eletrónicos de suporte do Daka ou por via postal no Porto, Portugal.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Responsável pelo Tratamento</h2>
        <p>O Daka, enquanto responsável pelo tratamento de dados:</p>
        <p className="pl-4">Assegura que o tratamento dos seus dados pessoais é efetuado estritamente no âmbito das finalidades de facilitação de trocas para as quais os mesmos foram recolhidos;</p>
        <p className="pl-4">Recolhe, utiliza e conserva apenas os dados pessoais necessários para a disponibilização do serviço (princípio da minimização dos dados);</p>
        <p className="pl-4">Não procede a qualquer transmissão ou venda de dados pessoais para fins comerciais ou de publicidade;</p>
        <p>Trata os dados pessoais para a prossecução do serviço solicitado pelo próprio utilizador, nos termos da alínea b) do n.º 1 do Artigo 6.º do RGPD.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Tipologia de Dados Pessoais que Recolhemos</h2>
        <p>No âmbito da plataforma Daka, recolhemos exclusivamente os dados necessários para o registo, gestão de perfil e facilitação das trocas de artigos entre utilizadores:</p>
        <p className="pl-4"><strong>Dados de Conta:</strong> Nome de utilizador (<em>username</em>), endereço de correio eletrónico e palavra-passe cifrada (armazenada sob forma de hash criptográfico irreversível através do algoritmo <code>bcrypt</code>). Na autenticação através de terceiros (Google OAuth), recebemos da Google o identificador da conta, o endereço de correio eletrónico, o nome e o endereço da fotografia de perfil. O nome e a fotografia são usados apenas quando a conta Daka é criada através da Google, como nome de utilizador e avatar iniciais, e podem ser alterados ou removidos a qualquer momento na página de perfil. O Daka não recebe a palavra-passe da conta Google nem tem acesso a outros dados ou serviços dessa conta;</p>
        <p className="pl-4"><strong>Dados de Perfil:</strong> Fotografia de avatar (opcional) e localização aproximada (concelho e freguesia selecionados a partir de dados públicos oficiais, sem recolha de morada postal nem rastreio contínuo por GPS);</p>
        <p className="pl-4"><strong>Anúncios e Propostas de Troca:</strong> Títulos, descrições, categorias, fotografias e estado de conservação dos artigos anunciados, documentos PDF anexados pelo anunciante (por exemplo manuais ou faturas), bem como o histórico de propostas de troca enviadas e recebidas. Os documentos são guardados sem os seus metadados, só podem ser abertos por utilizadores com sessão iniciada e são apagados quando o anúncio é removido ou a conta é eliminada;</p>
        <p className="pl-4"><strong>Mensagens de Troca:</strong> Comunicações trocadas diretamente entre utilizadores no chat interno da plataforma para a coordenação e conclusão das trocas.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Segurança dos Dados Pessoais</h2>
        <p>O Daka aplica medidas técnicas e organizativas adequadas para assegurar a confidencialidade e a integridade dos seus dados pessoais, nomeadamente:</p>
        <p className="pl-4">Comunicações integralmente cifradas através de ligação segura obrigatória por <strong>HTTPS</strong>;</p>
        <p className="pl-4">Armazenamento seguro de credenciais com funções de dispersão criptográfica irreversível (<em>hashing</em> com <code>bcrypt</code>);</p>
        <p className="pl-4">Gestão de sessões através de identificadores seguros com atributos <code>httpOnly</code>, <code>secure</code> e <code>SameSite=Lax</code>, prevenindo acessos indevidos por terceiros.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Direitos dos Titulares dos Dados</h2>
        <p>Nos termos do RGPD, o utilizador dispõe de um conjunto de direitos fundamentais que pode exercer a qualquer momento:</p>
        <p className="pl-4"><strong>Direito de Acesso:</strong> Consultar os seus dados pessoais, anúncios ativos e histórico de trocas diretamente na sua conta;</p>
        <p className="pl-4"><strong>Direito de Retificação:</strong> Corrigir e manter atualizados os seus dados de perfil (nome de utilizador, localização e fotografia de avatar) através da página de perfil;</p>
        <p className="pl-4"><strong>Direito ao Apagamento (&ldquo;Direito ao Esquecimento&rdquo;):</strong> O utilizador pode solicitar a qualquer momento a eliminação voluntária da sua conta nas definições de perfil. A eliminação definitiva anonimiza de imediato as informações pessoais, revoga todas as sessões ativas e retira os anúncios publicados;</p>
        <p className="pl-4"><strong>Direito de Oposição e Limitação:</strong> Opor-se ao tratamento ou requerer a limitação do mesmo nos termos legalmente previstos.</p>
        <p>Os seus dados pessoais são conservados na plataforma apenas pelo período estritamente necessário à prossecução das finalidades do serviço, cessando a sua conservação ativa com o cancelamento da conta pelo utilizador.</p>
        <p className="text-sm text-muted">Caso considere que os seus direitos não foram devidamente salvaguardados, assiste-lhe o direito de apresentar reclamação junto da autoridade de controlo nacional em Portugal: <strong>CNPD — Comissão Nacional de Proteção de Dados</strong> (<a href="https://www.cnpd.pt" target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">cnpd.pt</a>).</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Cookies e Tecnologias Semelhantes</h2>
        <p>A plataforma Daka utiliza exclusivamente <strong>cookies técnicos estritamente necessários</strong> para o correto funcionamento do serviço, designadamente cookies de sessão autenticada.</p>
        <p>A utilização destes cookies é indispensável para manter a sessão iniciada de forma segura (com atributos <code>httpOnly</code>, <code>secure</code> e <code>SameSite=Lax</code>) e prevenir vulnerabilidades como falsificação de pedidos entre sítios (CSRF).</p>
        <div className="p-4 rounded-xl bg-surface border border-line my-4">
          <p className="font-semibold text-brand mb-1">
            Sem rastreamento nem publicidade
          </p>
          <p className="text-sm text-ink/80">
            O Daka <strong>não utiliza</strong> cookies de publicidade, cookies de rastreamento comportamental nem ferramentas externas de analítica de terceiros (como Google Analytics ou pixels de redes sociais). Por esse motivo, a navegação não requer a apresentação de banners invasivos de consentimento de cookies.
          </p>
        </div>
        <p>O utilizador pode configurar o seu navegador para bloquear ou eliminar cookies a qualquer momento nas definições do respetivo programa. No entanto, alertamos que o bloqueio de cookies técnicos essenciais impossibilitará a autenticação e o acesso às funcionalidades de publicação e negociação de trocas.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Serviços de Terceiros</h2>
        <p>Ao escolher iniciar sessão com a Google, o utilizador é redirecionado para a Google (Google LLC), que trata os dados de autenticação de acordo com a sua própria política de privacidade.</p>
        <p>Quando a conta é criada através da Google, a fotografia de perfil continua alojada nos servidores da Google e é carregada diretamente a partir deles sempre que é apresentada. Para isso, o navegador de quem visualiza a página contacta a Google, que recebe dados técnicos de ligação, como o endereço IP e o tipo de navegador. O Daka não indica à Google em que página a fotografia é apresentada nem lhe transmite qualquer outro dado. O titular da conta pode substituir ou remover esta fotografia na página de perfil. A partir desse momento passa a ser apresentada uma fotografia guardada nos servidores do Daka, ou a inicial do nome.</p>
        <h2 className="text-2xl font-bold font-display mt-8 mb-4">Atualizações à Política de Privacidade</h2>
        <p>A presente Política de Privacidade pode ser atualizada pontualmente para refletir melhorias funcionais da plataforma ou novas exigências legais. Quaisquer alterações serão publicadas nesta página com a indicação da respetiva data de atualização.</p>
      </div>
    </main>
  )
}
