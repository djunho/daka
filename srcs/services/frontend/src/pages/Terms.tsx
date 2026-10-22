// Base unmodified text from: https://www.gov.pt/termos-e-condicoes
export default function Terms() {
  return (
    <main className="page max-w-3xl mx-auto px-4 py-12 text-ink">
      <header className="mb-8 pb-4 border-b border-line">
        <h1 className="page-title text-3xl md:text-4xl font-bold font-display mb-3">
          Termos de Serviço
        </h1>
        <p className="text-sm text-muted">
          Última atualização: Outubro de 2026 · Plataforma Daka
        </p>
      </header>

      <section className="space-y-4 mb-8 text-base leading-relaxed">
        <p>
          A plataforma Daka (<em>&ldquo;Toma-lá, dá-cá&rdquo;</em>) disponibiliza
          um espaço comunitário para facilitar o contacto entre utilizadores para a{' '}
          <strong>troca direta de artigos em segunda mão</strong>.
        </p>
        <p>
          Além de disponibilizar a publicação e pesquisa de anúncios, a plataforma
          permite realizar várias ações, tais como: propor e negociar trocas
          diretas entre membros, gerir anúncios próprios e guardar artigos favoritos.
        </p>
        <p>
          <strong>Princípio de trocas sem dinheiro:</strong> O Daka não é uma loja
          online nem um intermediário financeiro. A plataforma destina-se
          estritamente a trocas de bens em espécie, sendo proibida qualquer
          cobrança de valores, venda por dinheiro ou envio de quantias monetárias
          entre utilizadores.
        </p>
        <p>
          O acesso e a utilização da plataforma Daka são gratuitos e implicam a
          aceitação plena e sem reservas dos presentes Termos de Serviço.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-bold font-display mb-4">
          Conteúdos e Responsabilidade dos Utilizadores
        </h2>
        <div className="space-y-4 text-base leading-relaxed">
          <p>
            O conteúdo e o logótipo da plataforma Daka estão protegidos por
            direitos de autor e propriedade intelectual. Qualquer utilizador pode
            partilhar hiperligações para o Daka, desde que tal não tenha
            finalidades comerciais nem sugira falsamente uma associação ou apoio
            oficial por parte da plataforma.
          </p>
          <p>
            Cada utilizador é inteiramente responsável pelos conteúdos que publica
            na plataforma, incluindo títulos, descrições, fotografias de artigos e
            mensagens privadas de negociação. O utilizador compromete-se a agir de
            boa-fé, garantindo a veracidade das informações e o rigor na
            descrição do estado dos artigos disponibilizados para troca.
          </p>
          <h3 className="text-xl font-bold font-display pt-2">
            Artigos Estritamente Proibidos
          </h3>
          <p>
            É expressamente proibido publicar anúncios, oferecer ou solicitar a
            troca de bens cuja circulação ou cedência viole a legislação portuguesa
            ou comunitária, nomeadamente:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Armas de fogo, munições, réplicas, armas brancas ou material explosivo;
            </li>
            <li>
              Substâncias estupefacientes, psicotrópicas ou medicamentos (sujeitos ou
              não a receita médica);
            </li>
            <li>
              Artigos contrafeitos, cópias pirateadas ou quaisquer bens que violem
              direitos de propriedade intelectual ou direitos de autor;
            </li>
            <li>
              Animais vivos, espécies protegidas ou produtos de origem animal restritos;
            </li>
            <li>
              Documentos de identificação, cartões de crédito ou dados pessoais de
              terceiros;
            </li>
            <li>
              Bens furtados, extraviados ou de proveniência ilegítima.
            </li>
          </ul>
          <p className="text-sm text-muted">
            O Daka reserva-se o direito de remover de imediato quaisquer anúncios
            que violem estas proibições, podendo proceder à suspensão ou encerramento
            da conta infratora.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-bold font-display mb-4">
          Aviso Legal e Limitação de Responsabilidade
        </h2>
        <div className="space-y-4 text-base leading-relaxed">
          <p>
            Nos termos do Decreto-Lei n.º 7/2004, a plataforma Daka atua como
            mero prestador intermediário de serviços de alojamento da informação.
            Os conteúdos disponibilizados não estabelecem qualquer relação
            comercial ou contratual entre os utilizadores e o Daka.
          </p>
          <p>
            A plataforma não inspeciona previamente os bens e não é responsável
            pela exatidão das descrições, pela qualidade, segurança ou legalidade
            dos artigos trocados entre utilizadores, nem por eventuais perdas, danos
            ou litígios decorrentes das trocas acordadas.
          </p>

          <h3 className="text-xl font-bold font-display pt-2">
            Segurança em Trocas Presenciais
          </h3>
          <p>
            Como as trocas dependem da entrega física direta acordada entre
            particulares, recomendamos vivamente as seguintes medidas de segurança:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              Marcar os encontros sempre em <strong>locais públicos, movimentados e bem
              iluminados</strong> (estações de transportes, centros comerciais ou cafés);
            </li>
            <li>
              Fazer-se acompanhar por outra pessoa sempre que possível;
            </li>
            <li>
              Examinar cuidadosamente o artigo e verificar o seu funcionamento antes
              de dar a troca por concluída;
            </li>
            <li>
              Recusar qualquer pedido de transferência monetária, pagamento de
              portes ou depósito antecipado.
            </li>
          </ul>

          <h3 className="text-xl font-bold font-display pt-2">
            Encerramento de Conta e Lei Aplicável
          </h3>
          <p>
            O utilizador pode encerrar a sua conta a qualquer momento nas definições
            de perfil. A infração reiterada destes termos, a publicação de artigos
            proibidos ou condutas lesivas resultarão no encerramento imediato da
            conta.
          </p>
          <p className="text-sm text-muted">
            Os presentes Termos de Serviço regem-se pela lei portuguesa. Para a
            resolução de eventuais litígios emergentes da utilização da plataforma,
            é competente o foro da Comarca do Porto.
          </p>
        </div>
      </section>
    </main>
  )
}
