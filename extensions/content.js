const API_KEY = 'YOUR_API_KEY';
const END_POINT = 'https://8qzqbynvxk.execute-api.ap-northeast-1.amazonaws.com/dev';

const generateHTML = (response) => {
  let html = '';

  for (let i = 0; i < response.items.length; i++) {
    const item = response.items[i];
    html += `
    <section class="result_dateContainer">
      <a class="resultContents_Link click-searchlink" href="${item.link}">
        <p class="resultContents_LinkText">${item.link}</p>
        <h1 class="resultContents_titleText">${item.title}</h1>
        <p class="resultContents_Description">
          ${item.htmlSnippet}
        </p>
      </a>
    </section>
    `;

  }

  return html;
}

$(function(){
  let rhs = document.getElementById('rhs');

  if(rhs === null){
    const centerCol = document.querySelector('#center_col');
    //rhsがないなら、自分でdivを作る
    rhs = document.createElement('div');
    rhs.id = 'rhs';

    if(centerCol === null){
      return;
    }

    centerCol.parentElement.insertBefore(rhs, centerCol.nextSibling);
  }

  rhs.insertAdjacentHTML(
    'afterbegin', `
<div id="HK_result">
  <header class="resultHeader">
    <div class="resultHeader_inner">
      <h1 class="resultHeader_Title">WordNet Search</a>
      </h1>
    </div>
  </header>

  <div class="result_wrapper">
    <div id= "js-result_SearchData" class="result_SearchData"></div>
  </div>
</div>`
  );

  const searchDataResultEl = document.querySelector('#js-result_SearchData');
  const params = new URLSearchParams(location.search);
  const q = params.get('q');

  const customsearch =function(keyWord, option) {
    let url = `${END_POINT}/search?q=${keyWord}`;

    if(option){
      url = url + option
    }

    fetch(url, {
      headers: {
        'X-API-KEY': API_KEY,
      },
    })
      .then((response) => response.json())
      .then((d) => {
        const html = generateHTML(d);
        searchDataResultEl.insertAdjacentHTML('beforeend', html);
      })
      .catch((error) => {});
  };

  customsearch(q);
});